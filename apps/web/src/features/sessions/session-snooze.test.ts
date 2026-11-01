import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '@opencode/client'
import { isSnoozedSession, snoozeMetadata, unsnoozeMetadata } from './session-snooze'

function session(metadata?: SessionInfo['metadata']): SessionInfo {
  return { metadata } as SessionInfo
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
