import { describe, expect, it } from 'vitest'
import type { SessionMessageSynthetic } from '@opencode/client'
import { isSystemReminder, readSystemReminder } from './system-events'

function synthetic(text: string, created = 1): SessionMessageSynthetic {
  return {
    id: `synthetic-${created}`,
    type: 'synthetic',
    time: { created },
    text,
  }
}

describe('readSystemReminder', () => {
  it('strips the tags from a system reminder', () => {
    const event = readSystemReminder(
      synthetic('<system-reminder>\nYou are in Plan mode.\n</system-reminder>')
    )

    expect(event).toEqual({
      id: 'synthetic-1',
      kind: 'system-reminder',
      label: 'System Reminder',
      detail: 'You are in Plan mode.',
      time: 1,
    })
  })

  it('joins multiple reminder blocks', () => {
    const event = readSystemReminder(
      synthetic(
        '<system-reminder>First reminder</system-reminder>\n\n' +
          '<system-reminder>Second reminder</system-reminder>'
      )
    )

    expect(event?.detail).toBe('First reminder\n\nSecond reminder')
  })

  it('returns null for ordinary synthetic text', () => {
    expect(readSystemReminder(synthetic('Background job finished'))).toBeNull()
  })

  it('ignores empty reminder blocks', () => {
    expect(readSystemReminder(synthetic('<system-reminder>  \n</system-reminder>'))).toBeNull()
  })
})

describe('isSystemReminder', () => {
  it('recognizes a tagged synthetic message', () => {
    expect(isSystemReminder(synthetic('<system-reminder>Update</system-reminder>'))).toBe(true)
    expect(isSystemReminder(synthetic('Background job finished'))).toBe(false)
  })
})
