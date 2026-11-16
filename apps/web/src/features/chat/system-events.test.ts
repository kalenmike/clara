import { describe, expect, it } from 'vitest'
import type {
  ClaraSessionMessageLocationSwitched,
  ClaraSessionMessageSynthetic,
} from '@clara/api-contract'
import {
  isSystemReminder,
  locationEvent,
  readClaraEvent,
  readSystemReminder,
} from './system-events'

function synthetic(
  text: string,
  created = 1,
  description?: string,
  metadata?: ClaraSessionMessageSynthetic['metadata']
): ClaraSessionMessageSynthetic {
  return {
    id: `synthetic-${created}`,
    type: 'synthetic',
    time: { created },
    text,
    description,
    metadata,
  }
}

function locationSwitched(
  directory: string,
  created = 1,
  subpath?: string
): ClaraSessionMessageLocationSwitched {
  return {
    id: `location-${created}`,
    type: 'location-switched',
    time: { created },
    location: { directory },
    ...(subpath ? { subpath } : {}),
  }
}

describe('readClaraEvent', () => {
  it('falls back to the kind label without a description', () => {
    const event = readClaraEvent(
      synthetic('Start the draft', 1, undefined, { clara: { kind: 'draft-start' } })
    )

    expect(event).toMatchObject({ kind: 'draft-start', label: 'Started saved draft' })
  })

  it('uses the description as the visible label', () => {
    const event = readClaraEvent(
      synthetic('Start the draft', 1, 'User confirmed. Starting saved draft.', {
        clara: { kind: 'draft-start' },
      })
    )

    expect(event?.label).toBe('User confirmed. Starting saved draft.')
  })
})

describe('locationEvent', () => {
  it('prefers the harness subpath over the absolute directory', () => {
    const event = locationEvent(
      locationSwitched('/home/me/worktrees/feature', 2, '../worktrees/feature')
    )

    expect(event).toEqual({
      id: 'location-2',
      kind: 'location-switched',
      label: 'Location switched',
      context: '../worktrees/feature',
      time: 2,
    })
  })

  it('falls back to the directory when there is no subpath', () => {
    expect(locationEvent(locationSwitched('/repo'))?.context).toBe('/repo')
  })
})

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
