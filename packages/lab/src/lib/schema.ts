// Derives form fields from the JSON Schema the orchestrator publishes for each
// MCP tool. The lab only needs the subset of draft-07 that the Clara tool
// surface emits: objects, nested objects, strings, integers, numbers,
// booleans, string enums, and arrays of strings. Anything else falls back to a
// JSON textarea so a new tool can never render a broken form.

interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  default?: unknown
}

export type FieldKind =
  'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'json'

export interface FieldSpec {
  name: string
  path: string[]
  kind: FieldKind
  description?: string
  required: boolean
  nullable: boolean
  enumValues?: string[]
  children?: FieldSpec[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  default?: unknown
}

// Every leaf control holds text; objects hold nested records. Converting to
// real argument types happens once, in buildArgs.
export type FieldValues = { [key: string]: string | FieldValues }

const MAX_SAFE = Number.MAX_SAFE_INTEGER

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFieldValues(value: unknown): value is FieldValues {
  return isRecord(value)
}

function readSchema(raw: unknown): JsonSchema {
  return isRecord(raw) ? (raw as JsonSchema) : {}
}

function schemaTypes(schema: JsonSchema): { type?: string; nullable: boolean } {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((entry): entry is string => typeof entry === 'string')
    const nonNull = types.filter((entry) => entry !== 'null')
    return {
      type: nonNull.length === 1 ? nonNull[0] : undefined,
      nullable: types.includes('null'),
    }
  }
  return {
    type: typeof schema.type === 'string' ? schema.type : undefined,
    nullable: false,
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function countOrUndefined(value: unknown): number | undefined {
  const parsed = numberOrUndefined(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return ''
  }
}

function describeField(name: string, raw: unknown, parent: string[], required: boolean): FieldSpec {
  const schema = readSchema(raw)
  const { type, nullable } = schemaTypes(schema)
  const spec: FieldSpec = {
    name,
    path: [...parent, name],
    kind: 'json',
    required,
    nullable,
  }

  if (typeof schema.description === 'string') spec.description = schema.description
  if (schema.default !== undefined) spec.default = schema.default

  const minimum = numberOrUndefined(schema.minimum)
  const maximum = numberOrUndefined(schema.maximum)
  const exclusiveMinimum = numberOrUndefined(schema.exclusiveMinimum)
  const exclusiveMaximum = numberOrUndefined(schema.exclusiveMaximum)
  const minLength = countOrUndefined(schema.minLength)
  const maxLength = countOrUndefined(schema.maxLength)
  const minItems = countOrUndefined(schema.minItems)
  const maxItems = countOrUndefined(schema.maxItems)
  if (minimum !== undefined) spec.minimum = minimum
  if (maximum !== undefined) spec.maximum = maximum
  if (exclusiveMinimum !== undefined) spec.exclusiveMinimum = exclusiveMinimum
  if (exclusiveMaximum !== undefined) spec.exclusiveMaximum = exclusiveMaximum
  if (minLength !== undefined) spec.minLength = minLength
  if (maxLength !== undefined) spec.maxLength = maxLength
  if (minItems !== undefined) spec.minItems = minItems
  if (maxItems !== undefined) spec.maxItems = maxItems

  if (Array.isArray(schema.enum)) {
    if (schema.enum.every((value): value is string => typeof value === 'string')) {
      spec.kind = 'enum'
      spec.enumValues = schema.enum
    }
    return spec
  }

  if (type === 'object' || (type === undefined && isRecord(schema.properties))) {
    if (isRecord(schema.properties) && Object.keys(schema.properties).length) {
      const requiredNames = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === 'string')
        : []
      spec.kind = 'object'
      spec.children = Object.entries(schema.properties).map(([key, child]) =>
        describeField(key, child, spec.path, requiredNames.includes(key))
      )
    }
    return spec
  }

  if (type === 'array') {
    const items = isRecord(schema.items) ? schema.items : undefined
    const itemTypes = items ? schemaTypes(items) : { type: undefined, nullable: false }
    if (itemTypes.type === 'string' && !Array.isArray(items?.enum) && !items?.properties) {
      spec.kind = 'array'
    }
    return spec
  }

  switch (type) {
    case 'string':
      spec.kind = 'string'
      break
    case 'integer':
      spec.kind = 'integer'
      break
    case 'number':
      spec.kind = 'number'
      break
    case 'boolean':
      spec.kind = 'boolean'
      break
    default:
      spec.kind = 'json'
  }

  return spec
}

/**
 * Returns one field per top-level argument. An empty array means the tool takes
 * no arguments; null means the schema cannot be rendered as a form at all.
 */
export function describeToolInput(input: unknown): FieldSpec[] | null {
  if (!isRecord(input)) return null
  const schema = input as JsonSchema
  const { type } = schemaTypes(schema)
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  if (!properties) {
    return type === 'object' ? [] : null
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : []
  return Object.entries(properties).map(([name, child]) =>
    describeField(name, child, [], required.includes(name))
  )
}

export function initialValues(fields: FieldSpec[]): FieldValues {
  const values: FieldValues = {}
  for (const field of fields) {
    if (field.kind === 'object' && field.children) {
      values[field.name] = initialValues(field.children)
    } else if (field.default !== undefined) {
      values[field.name] = defaultText(field)
    } else {
      values[field.name] = ''
    }
  }
  return values
}

function defaultText(field: FieldSpec): string {
  if (field.kind === 'boolean') return field.default === true ? 'true' : 'false'
  if (field.kind === 'json') return jsonText(field.default)
  if (field.kind === 'array') {
    return Array.isArray(field.default) ? field.default.map((item) => String(item)).join('\n') : ''
  }
  return String(field.default)
}

export function setFieldValue(values: FieldValues, path: string[], value: string): FieldValues {
  const [head, ...rest] = path
  if (head === undefined) return values
  if (!rest.length) return { ...values, [head]: value }
  const current = values[head]
  const child = isFieldValues(current) ? current : {}
  return { ...values, [head]: setFieldValue(child, rest, value) }
}

export interface BuiltArgs {
  args: Record<string, unknown>
  errors: Record<string, string>
}

export function buildArgs(fields: FieldSpec[], values: FieldValues): BuiltArgs {
  const args: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const value = values[field.name]
    const key = field.path.join('.')

    if (field.kind === 'object') {
      const childValues = isFieldValues(value) ? value : {}
      const blank = (field.children ?? []).every((child) =>
        isFieldBlank(child, childValues[child.name])
      )
      if (blank && !field.required) continue
      const nested = buildArgs(field.children ?? [], childValues)
      Object.assign(errors, nested.errors)
      args[field.name] = nested.args
      continue
    }

    const text = typeof value === 'string' ? value : ''

    if (field.kind === 'array') {
      if (!text.trim() && !field.required) continue
      const items = text
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
      if (field.minItems !== undefined && items.length < field.minItems) {
        errors[key] = atLeast(field.minItems, 'item')
        continue
      }
      if (field.maxItems !== undefined && items.length > field.maxItems) {
        errors[key] = atMost(field.maxItems, 'item')
        continue
      }
      args[field.name] = items
      continue
    }

    if (!text.trim()) {
      if (!field.required) continue
      errors[key] = 'Required.'
      continue
    }

    switch (field.kind) {
      case 'integer':
      case 'number': {
        const parsed = Number(text)
        if (!Number.isFinite(parsed)) {
          errors[key] = 'Enter a number.'
          break
        }
        if (field.kind === 'integer' && !Number.isInteger(parsed)) {
          errors[key] = 'Enter a whole number.'
          break
        }
        const message = rangeError(field, parsed)
        if (message) {
          errors[key] = message
          break
        }
        args[field.name] = parsed
        break
      }
      case 'boolean':
        if (text !== 'true' && text !== 'false') {
          errors[key] = 'Choose true or false.'
          break
        }
        args[field.name] = text === 'true'
        break
      case 'enum':
        if (!field.enumValues?.includes(text)) {
          errors[key] = `Choose one of ${(field.enumValues ?? []).join(', ')}.`
          break
        }
        args[field.name] = text
        break
      case 'json':
        try {
          args[field.name] = JSON.parse(text) as unknown
        } catch {
          errors[key] = 'Invalid JSON.'
        }
        break
      case 'string':
        if (field.minLength !== undefined && text.length < field.minLength) {
          errors[key] = atLeast(field.minLength, 'character')
          break
        }
        if (field.maxLength !== undefined && text.length > field.maxLength) {
          errors[key] = atMost(field.maxLength, 'character')
          break
        }
        args[field.name] = text
        break
      default:
        break
    }
  }

  return { args, errors }
}

function isFieldBlank(field: FieldSpec, value: string | FieldValues | undefined): boolean {
  if (field.kind === 'object') {
    const childValues = isFieldValues(value) ? value : {}
    return (field.children ?? []).every((child) => isFieldBlank(child, childValues[child.name]))
  }
  return typeof value !== 'string' || value.trim() === ''
}

function rangeError(field: FieldSpec, value: number): string | undefined {
  if (field.exclusiveMinimum !== undefined && value <= field.exclusiveMinimum) {
    return `Must be greater than ${field.exclusiveMinimum}.`
  }
  if (field.minimum !== undefined && value < field.minimum) {
    return `Must be at least ${field.minimum}.`
  }
  if (field.exclusiveMaximum !== undefined && value >= field.exclusiveMaximum) {
    return `Must be less than ${field.exclusiveMaximum}.`
  }
  if (field.maximum !== undefined && field.maximum < MAX_SAFE && value > field.maximum) {
    return `Must be at most ${field.maximum}.`
  }
  return undefined
}

function atLeast(count: number, noun: string): string {
  return `At least ${count} ${noun}${count === 1 ? '' : 's'}.`
}

function atMost(count: number, noun: string): string {
  return `At most ${count} ${noun}${count === 1 ? '' : 's'}.`
}

export function valuesFromArgs(fields: FieldSpec[], args: unknown): FieldValues {
  const source = isRecord(args) ? args : {}
  const values = initialValues(fields)
  for (const field of fields) {
    const value = source[field.name]
    if (field.kind === 'object') {
      values[field.name] = valuesFromArgs(field.children ?? [], value)
      continue
    }
    if (value === undefined || value === null) continue
    if (field.kind === 'array') {
      values[field.name] = Array.isArray(value) ? value.map((item) => String(item)).join('\n') : ''
      continue
    }
    if (field.kind === 'boolean') {
      values[field.name] = value === 'true' || value === true ? 'true' : 'false'
      continue
    }
    if (field.kind === 'json') {
      values[field.name] = jsonText(value)
      continue
    }
    values[field.name] = String(value)
  }
  return values
}

/** Swagger-style hint line: type, requiredness, and the constraint ranges. */
export function fieldHints(field: FieldSpec): string[] {
  const kind =
    field.kind === 'json' ? 'any JSON' : field.kind === 'array' ? 'list of strings' : field.kind
  const hints = [kind, field.required ? 'required' : 'optional']
  if (field.nullable) hints.push('nullable')
  if (field.exclusiveMinimum !== undefined) {
    hints.push(`> ${field.exclusiveMinimum}`)
  } else if (field.minimum !== undefined) {
    hints.push(`min ${field.minimum}`)
  }
  if (field.exclusiveMaximum !== undefined) {
    hints.push(`< ${field.exclusiveMaximum}`)
  } else if (field.maximum !== undefined && field.maximum < MAX_SAFE) {
    hints.push(`max ${field.maximum}`)
  }
  if (field.minLength !== undefined)
    hints.push(`min ${field.minLength} ${characters(field.minLength)}`)
  if (field.maxLength !== undefined)
    hints.push(`max ${field.maxLength} ${characters(field.maxLength)}`)
  if (field.minItems !== undefined) hints.push(`min ${field.minItems} ${items(field.minItems)}`)
  if (field.maxItems !== undefined) hints.push(`max ${field.maxItems} ${items(field.maxItems)}`)
  if (field.enumValues) hints.push(`one of ${field.enumValues.join(', ')}`)
  return hints
}

function characters(count: number): string {
  return count === 1 ? 'character' : 'characters'
}

function items(count: number): string {
  return count === 1 ? 'item' : 'items'
}
