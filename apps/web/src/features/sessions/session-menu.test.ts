import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { sessionMenuEntries } from './session-menu'

function session(options: { snoozed?: boolean; archived?: boolean } = {}): ClaraSession {
  return {
    id: 'session-1',
    metadata: options.snoozed ? { snoozed: true } : undefined,
    time: {
      created: 1,
      updated: 1,
      ...(options.archived ? { archived: 2 } : {}),
    },
  } as ClaraSession
}

const wording = { lowerSingular: 'brief' }

describe('sessionMenuEntries', () => {
  it('offers snooze, archive, and delete on an active session', () => {
    expect(sessionMenuEntries(session(), wording)).toEqual([
      { action: 'snooze', label: 'Snooze brief' },
      { action: 'archive', label: 'Archive brief' },
      { action: 'delete', label: 'Delete brief', destructive: true },
    ])
  })

  it('offers unsnooze instead of snooze', () => {
    expect(sessionMenuEntries(session({ snoozed: true }), wording)).toEqual([
      { action: 'unsnooze', label: 'Remove from Snoozed' },
      { action: 'archive', label: 'Archive brief' },
      { action: 'delete', label: 'Delete brief', destructive: true },
    ])
  })

  it('hides snooze and reopens an archived session', () => {
    expect(sessionMenuEntries(session({ archived: true }), wording)).toEqual([
      { action: 'reopen', label: 'Reopen brief' },
      { action: 'delete', label: 'Delete brief', destructive: true },
    ])
  })

  it('follows the configured session noun', () => {
    expect(sessionMenuEntries(session(), { lowerSingular: 'task' })[0]).toEqual({
      action: 'snooze',
      label: 'Snooze task',
    })
  })
})
