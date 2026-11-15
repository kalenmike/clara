import { describe, expect, it } from 'vitest'
import { composerActions } from './composer-actions'

const base = {
  ready: true,
  hasSession: true,
  busy: false,
  empty: false,
  archived: false,
  snoozed: false,
  hasText: true,
  canSaveDraft: false,
  planReady: false,
  formWaiting: false,
}

describe('composer send actions', () => {
  it('offers Done on an idle session with messages', () => {
    expect(composerActions(base)).toEqual(['done'])
  })

  it('offers Start work first when a plan is ready', () => {
    expect(composerActions({ ...base, planReady: true })).toEqual(['start-plan', 'done'])
  })

  it('hides Start work while a question is waiting', () => {
    expect(composerActions({ ...base, planReady: true, formWaiting: true })).toEqual(['done'])
  })

  it('offers Start work for a snoozed session with a ready plan', () => {
    expect(composerActions({ ...base, planReady: true, snoozed: true })).toEqual([
      'start-plan',
      'reopen',
    ])
  })

  it('offers Save as draft before the first reply', () => {
    expect(composerActions({ ...base, empty: true, canSaveDraft: true })).toEqual([
      'save-draft',
      'delete-empty',
    ])
  })

  it('offers only queuing while busy', () => {
    expect(composerActions({ ...base, busy: true, hasText: true })).toEqual(['queue'])
    expect(composerActions({ ...base, busy: true, hasText: false })).toEqual([])
  })

  it('offers Reopen for archived and snoozed sessions', () => {
    expect(composerActions({ ...base, archived: true })).toEqual(['reopen'])
    expect(composerActions({ ...base, snoozed: true })).toEqual(['reopen'])
  })

  it('offers Delete for an empty draft', () => {
    expect(composerActions({ ...base, empty: true })).toEqual(['delete-empty'])
  })

  it('hides every action until the session is known', () => {
    expect(composerActions({ ...base, ready: false })).toEqual([])
    expect(composerActions({ ...base, hasSession: false })).toEqual([])
  })
})
