import { describe, expect, it } from 'vitest'
import { formatSessionAge } from './format'

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function age(ms: number): string {
  return formatSessionAge(NOW - ms, NOW)
}

describe('formatSessionAge', () => {
  it('uses "just now" for a fresh or future session', () => {
    expect(age(0)).toBe('started just now')
    expect(age(59_999)).toBe('started just now')
    expect(formatSessionAge(NOW + MINUTE, NOW)).toBe('started just now')
  })

  it('rounds down to whole minutes and hours', () => {
    expect(age(MINUTE)).toBe('started 1 minute ago')
    expect(age(59 * MINUTE + 59_000)).toBe('started 59 minutes ago')
    expect(age(HOUR)).toBe('started 1 hour ago')
    expect(age(23 * HOUR + 59 * MINUTE)).toBe('started 23 hours ago')
  })

  it('uses days up to one month', () => {
    expect(age(DAY)).toBe('started 1 day ago')
    expect(age(7 * DAY)).toBe('started 7 days ago')
    expect(age(29 * DAY)).toBe('started 29 days ago')
  })

  it('uses months and years for older sessions', () => {
    expect(age(30 * DAY)).toBe('started 1 month ago')
    expect(age(345 * DAY)).toBe('started 11 months ago')
    expect(age(365 * DAY)).toBe('started 1 year ago')
    expect(age(2 * 365 * DAY)).toBe('started 2 years ago')
  })
})
