import { describe, expect, it } from 'vitest'
import { resolveSessionStatus } from './session-status'

const idle = { snoozed: false, active: false, attention: null } as const

describe('resolveSessionStatus', () => {
  it('prefers snoozed over every other signal', () => {
    expect(resolveSessionStatus({ snoozed: true, active: true, attention: 'question' })).toBe(
      'snoozed'
    )
  })

  it('shows a waiting question before a running turn', () => {
    expect(resolveSessionStatus({ snoozed: false, active: true, attention: 'question' })).toBe(
      'question'
    )
  })

  it('shows a running turn before every finished state', () => {
    for (const attention of ['error', 'plan', 'review'] as const) {
      expect(resolveSessionStatus({ snoozed: false, active: true, attention })).toBe('active')
    }
  })

  it('keeps each finished state when the session is idle', () => {
    for (const attention of ['error', 'plan', 'review'] as const) {
      expect(resolveSessionStatus({ snoozed: false, active: false, attention })).toBe(attention)
    }
  })

  it('falls back to an idle dot', () => {
    expect(resolveSessionStatus(idle)).toBe('idle')
  })
})
