import { describe, expect, it } from 'vitest'
import type { ClaraFormField, ClaraForm } from '@clara/api-contract'
import {
  composerCanSend,
  composerRequestCount,
  composerSecondaryAction,
  defaultComposerSelection,
  initialFormAnswers,
  resolveComposerSelection,
  type ComposerRequestSelection,
} from './composer-requests'

function form(id: string): ClaraForm {
  return {
    id,
    sessionID: 'session-1',
    title: `Question ${id}`,
    fields: [] as unknown as ClaraForm['fields'],
  }
}

describe('composerRequestCount', () => {
  it('counts pending forms and the plan-ready handoff', () => {
    expect(composerRequestCount([], false)).toBe(0)
    expect(composerRequestCount([form('a'), form('b')], false)).toBe(2)
    expect(composerRequestCount([], true)).toBe(1)
    expect(composerRequestCount([form('a')], true)).toBe(2)
  })
})

describe('composerCanSend', () => {
  const base = { text: '', formTouched: false, hasActiveForm: false }

  it('allows Send with a message or a touched form', () => {
    expect(composerCanSend(base)).toBe(false)
    expect(composerCanSend({ ...base, text: 'Hello' })).toBe(true)
    expect(composerCanSend({ ...base, hasActiveForm: true })).toBe(false)
    expect(composerCanSend({ ...base, hasActiveForm: true, formTouched: true })).toBe(true)
    expect(composerCanSend({ ...base, hasActiveForm: true, text: 'Hello' })).toBe(true)
  })
})

describe('composerSecondaryAction', () => {
  it('offers Skip for questions and Start for a ready plan', () => {
    expect(composerSecondaryAction({ hasActiveForm: true, planSelected: false })).toBe('skip')
    expect(composerSecondaryAction({ hasActiveForm: false, planSelected: true })).toBe('start')
    expect(composerSecondaryAction({ hasActiveForm: false, planSelected: false })).toBeNull()
  })
})

describe('defaultComposerSelection', () => {
  it('selects the first form before the plan', () => {
    expect(defaultComposerSelection([form('a'), form('b')], true)).toEqual({
      kind: 'form',
      formID: 'a',
    })
  })

  it('selects the plan when no form is waiting', () => {
    expect(defaultComposerSelection([], true)).toEqual({ kind: 'plan' })
  })

  it('selects nothing when the session is idle', () => {
    expect(defaultComposerSelection([], false)).toBe('none')
  })
})

describe('resolveComposerSelection', () => {
  it('keeps a valid form selection', () => {
    expect(
      resolveComposerSelection([form('a'), form('b')], true, { kind: 'form', formID: 'b' })
    ).toEqual({ kind: 'form', formID: 'b' })
  })

  it('keeps the plan selection while the plan is ready', () => {
    expect(resolveComposerSelection([form('a')], true, { kind: 'plan' })).toEqual({
      kind: 'plan',
    })
  })

  it('falls back when the selected form disappears', () => {
    expect(resolveComposerSelection([form('b')], true, { kind: 'form', formID: 'a' })).toEqual({
      kind: 'form',
      formID: 'b',
    })
  })

  it('falls back to the plan when no form remains', () => {
    expect(resolveComposerSelection([], true, { kind: 'form', formID: 'a' })).toEqual({
      kind: 'plan',
    })
  })

  it('falls back to nothing when the plan stops being ready', () => {
    expect(resolveComposerSelection([], false, { kind: 'plan' })).toBe('none')
  })

  it('keeps an explicit message-only choice', () => {
    const choice: ComposerRequestSelection = 'none'
    expect(resolveComposerSelection([form('a')], true, choice)).toBe('none')
  })

  it('defaults when no explicit choice exists', () => {
    expect(resolveComposerSelection([form('a')], true, null)).toEqual({
      kind: 'form',
      formID: 'a',
    })
  })
})

describe('initialFormAnswers', () => {
  it('seeds visible fields from their defaults', () => {
    const fields = [
      { key: 'name', type: 'string', default: 'checkout' },
      { key: 'replicas', type: 'integer', default: 3 },
      { key: 'confirm', type: 'boolean', default: true },
      {
        key: 'regions',
        type: 'multiselect',
        default: ['eu'],
        options: [{ value: 'eu', label: 'Europe' }],
      },
      { key: 'secret', type: 'string', hidden: true, default: 'hidden' },
    ] as ClaraFormField[]

    expect(initialFormAnswers(fields)).toEqual({
      name: 'checkout',
      replicas: 3,
      confirm: true,
      regions: ['eu'],
    })
  })
})
