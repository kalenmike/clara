import { describe, expect, it } from 'vitest'
import type { FieldSpec } from '../src/lib/schema'
import {
  buildArgs,
  describeToolInput,
  fieldHints,
  initialValues,
  setFieldValue,
  valuesFromArgs,
} from '../src/lib/schema'

const nextSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'integer', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    limit: { type: 'integer', minimum: 1, maximum: 32 },
  },
  required: ['run_id'],
  $schema: 'http://json-schema.org/draft-07/schema#',
}

const startSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', minLength: 1, description: 'The initial request' },
    workspace: { type: 'string', minLength: 1 },
    target: { type: 'string' },
    origin: {
      description: 'Who submitted the request',
      type: 'object',
      properties: {
        session_id: { type: ['string', 'null'] },
        harness: { type: ['string', 'null'] },
        kind: { type: 'string', enum: ['human', 'agent', 'api', 'worker'] },
      },
    },
  },
  required: ['prompt', 'workspace'],
}

function fieldsOf(schema: unknown): FieldSpec[] {
  const fields = describeToolInput(schema)
  if (!fields) throw new Error('expected a form-renderable schema')
  return fields
}

function fieldOf(fields: FieldSpec[], name: string): FieldSpec {
  const found = fields.find((field) => field.name === name)
  if (!found) throw new Error(`missing field ${name}`)
  return found
}

describe('tool input derivation', () => {
  it('rejects schemas that cannot become a form', () => {
    expect(describeToolInput(undefined)).toBeNull()
    expect(describeToolInput({})).toBeNull()
    expect(describeToolInput({ type: 'string' })).toBeNull()
  })

  it('treats an empty object schema as no arguments', () => {
    expect(describeToolInput({ type: 'object', properties: {} })).toEqual([])
  })

  it('marks required fields and drops the safe-integer bound', () => {
    const fields = fieldsOf(nextSchema)
    expect(fieldOf(fields, 'run_id').required).toBe(true)
    expect(fieldOf(fields, 'limit').required).toBe(false)
    expect(fieldHints(fieldOf(fields, 'run_id'))).toEqual(['integer', 'required', '> 0'])
    expect(fieldHints(fieldOf(fields, 'limit'))).toEqual(['integer', 'optional', 'min 1', 'max 32'])
  })

  it('derives nested objects, enums, and nullable strings', () => {
    const fields = fieldsOf(startSchema)
    const origin = fieldOf(fields, 'origin')
    expect(origin.kind).toBe('object')
    expect(origin.description).toBe('Who submitted the request')
    const children = origin.children ?? []
    expect(fieldOf(children, 'kind').kind).toBe('enum')
    expect(fieldOf(children, 'kind').enumValues).toEqual(['human', 'agent', 'api', 'worker'])
    expect(fieldHints(fieldOf(children, 'session_id'))).toEqual(['string', 'optional', 'nullable'])
  })

  it('falls back to a JSON field for opaque schemas', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: { result: { description: 'The step result' } },
      required: ['result'],
    })
    expect(fieldOf(fields, 'result').kind).toBe('json')
    expect(fieldHints(fieldOf(fields, 'result'))).toEqual(['any JSON', 'required'])
  })

  it('seeds schema defaults into form values', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: { region: { type: 'string', default: 'eu' } },
    })
    expect(initialValues(fields)).toEqual({ region: 'eu' })
  })
})

describe('argument building', () => {
  it('omits blank optional fields and reports required ones', () => {
    const fields = fieldsOf(nextSchema)
    expect(buildArgs(fields, initialValues(fields))).toEqual({
      args: {},
      errors: { run_id: 'Required.' },
    })
    const filled = setFieldValue(initialValues(fields), ['run_id'], '7')
    expect(buildArgs(fields, filled)).toEqual({ args: { run_id: 7 }, errors: {} })
  })

  it('validates integer ranges and types', () => {
    const fields = fieldsOf(nextSchema)
    const base = setFieldValue(initialValues(fields), ['run_id'], '3')
    expect(buildArgs(fields, setFieldValue(base, ['limit'], '0')).errors).toEqual({
      limit: 'Must be at least 1.',
    })
    expect(buildArgs(fields, setFieldValue(base, ['limit'], '33')).errors).toEqual({
      limit: 'Must be at most 32.',
    })
    expect(buildArgs(fields, setFieldValue(base, ['limit'], '1.5')).errors).toEqual({
      limit: 'Enter a whole number.',
    })
    expect(buildArgs(fields, setFieldValue(base, ['limit'], 'many')).errors).toEqual({
      limit: 'Enter a number.',
    })
    expect(buildArgs(fields, setFieldValue(base, ['run_id'], '0')).errors).toEqual({
      run_id: 'Must be greater than 0.',
    })
  })

  it('includes a nested object only when a child has a value', () => {
    const fields = fieldsOf(startSchema)
    const base = setFieldValue(
      setFieldValue(initialValues(fields), ['prompt'], 'Ship it'),
      ['workspace'],
      '/repo'
    )
    expect(buildArgs(fields, base).args).toEqual({ prompt: 'Ship it', workspace: '/repo' })

    const withOrigin = setFieldValue(base, ['origin', 'kind'], 'agent')
    expect(buildArgs(fields, withOrigin).args).toEqual({
      prompt: 'Ship it',
      workspace: '/repo',
      origin: { kind: 'agent' },
    })
  })

  it('keeps a required object with only optional children as an empty object', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: {
        run_id: { type: 'integer', exclusiveMinimum: 0 },
        usage: {
          type: 'object',
          properties: { turns: { type: 'integer', minimum: 0 } },
        },
      },
      required: ['run_id', 'usage'],
    })
    const values = setFieldValue(initialValues(fields), ['run_id'], '1')
    expect(buildArgs(fields, values)).toEqual({ args: { run_id: 1, usage: {} }, errors: {} })
  })

  it('parses opaque JSON fields', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: { result: { description: 'The step result' } },
      required: ['result'],
    })
    expect(buildArgs(fields, initialValues(fields)).errors).toEqual({ result: 'Required.' })
    expect(
      buildArgs(fields, setFieldValue(initialValues(fields), ['result'], '{"ok":true}')).args
    ).toEqual({ result: { ok: true } })
    expect(
      buildArgs(fields, setFieldValue(initialValues(fields), ['result'], '{oops')).errors
    ).toEqual({ result: 'Invalid JSON.' })
  })

  it('splits string arrays one per line and checks minItems', () => {
    const fields = fieldsOf({
      type: 'object',
      properties: {
        capabilities: { type: 'array', items: { type: 'string' }, minItems: 1 },
        resources: { type: 'array', items: { type: 'string' } },
      },
      required: ['capabilities'],
    })
    expect(fieldOf(fields, 'capabilities').kind).toBe('array')
    expect(fieldHints(fieldOf(fields, 'capabilities'))).toEqual([
      'list of strings',
      'required',
      'min 1 item',
    ])
    expect(buildArgs(fields, initialValues(fields)).errors).toEqual({
      capabilities: 'At least 1 item.',
    })
    const values = setFieldValue(initialValues(fields), ['capabilities'], 'tool\n path \n')
    expect(buildArgs(fields, values).args).toEqual({ capabilities: ['tool', 'path'] })
    const withResources = setFieldValue(values, ['resources'], 'a\nb')
    expect(buildArgs(fields, withResources).args).toEqual({
      capabilities: ['tool', 'path'],
      resources: ['a', 'b'],
    })
  })

  it('rejects enum values that did not come from the select', () => {
    const fields = fieldsOf(startSchema)
    const values = valuesFromArgs(fields, {
      prompt: 'x',
      workspace: '/repo',
      origin: { kind: 'robot' },
    })
    expect(buildArgs(fields, values).errors).toEqual({
      'origin.kind': 'Choose one of human, agent, api, worker.',
    })
  })
})

describe('form values', () => {
  it('maps arguments back into form values', () => {
    const fields = fieldsOf(startSchema)
    expect(
      valuesFromArgs(fields, {
        prompt: 'Hi',
        workspace: '/repo',
        origin: { session_id: null, harness: 'opencode', kind: 'worker' },
      })
    ).toEqual({
      prompt: 'Hi',
      workspace: '/repo',
      target: '',
      origin: { session_id: '', harness: 'opencode', kind: 'worker' },
    })
  })

  it('does not mutate the parent record when a field changes', () => {
    const fields = fieldsOf(startSchema)
    const base = initialValues(fields)
    const next = setFieldValue(base, ['origin', 'kind'], 'agent')
    expect(base.origin).toEqual({ session_id: '', harness: '', kind: '' })
    expect(next.origin).toEqual({ session_id: '', harness: '', kind: 'agent' })
  })
})
