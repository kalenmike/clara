import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { isSnoozedSession, snoozeMetadata, unsnoozeMetadata } from './session-snooze'

function session(metadata?: ClaraSession['metadata']): ClaraSession {
  return { metadata } as ClaraSession
}

describe('isSnoozedSession', () => {
  it('reads only the snoozed metadata key', () => {
    expect(isSnoozedSession(session())).toBe(false)
    expect(isSnoozedSession(session({ snoozed: 'true' }))).toBe(false)
    expect(isSnoozedSession(session({ snoozed: true }))).toBe(true)
  })
})

describe('snoozeMetadata', () => {
  it('keeps metadata written by other clients', () => {
    expect(snoozeMetadata({ pinned: true })).toEqual({ pinned: true, snoozed: true })
    expect(snoozeMetadata(undefined)).toEqual({ snoozed: true })
  })
})

describe('unsnoozeMetadata', () => {
  it('removes only the snooze marker', () => {
    expect(unsnoozeMetadata({ pinned: true, snoozed: true, note: 'keep' })).toEqual({
      pinned: true,
      note: 'keep',
    })
  })

  it('returns an empty object when nothing else is stored', () => {
    expect(unsnoozeMetadata({ snoozed: true })).toEqual({})
    expect(unsnoozeMetadata(undefined)).toEqual({})
  })
})
