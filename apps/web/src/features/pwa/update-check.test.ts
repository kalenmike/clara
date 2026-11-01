import { describe, expect, it } from 'vitest'
import {
  dueForUpdateCheck,
  FOCUS_CHECK_INTERVAL_MS,
  IDLE_CHECK_INTERVAL_MS,
  isUpdateAvailable,
} from './update-check'

describe('dueForUpdateCheck', () => {
  const base = { lastCheckAt: 1_000_000, online: true, force: false }

  it('checks once the idle interval has passed', () => {
    expect(dueForUpdateCheck({ ...base, now: base.lastCheckAt + IDLE_CHECK_INTERVAL_MS })).toBe(
      true
    )
  })

  it('waits out the idle interval', () => {
    expect(dueForUpdateCheck({ ...base, now: base.lastCheckAt + 1_000 })).toBe(false)
  })

  it('checks on focus sooner than the idle interval', () => {
    expect(
      dueForUpdateCheck({
        ...base,
        force: true,
        now: base.lastCheckAt + IDLE_CHECK_INTERVAL_MS - 1,
      })
    ).toBe(true)
  })

  it('does not let a burst of focus events hammer the worker', () => {
    expect(
      dueForUpdateCheck({
        ...base,
        force: true,
        now: base.lastCheckAt + FOCUS_CHECK_INTERVAL_MS - 1,
      })
    ).toBe(false)
  })

  it('never checks while offline', () => {
    expect(
      dueForUpdateCheck({
        ...base,
        online: false,
        force: true,
        now: base.lastCheckAt + IDLE_CHECK_INTERVAL_MS,
      })
    ).toBe(false)
  })

  it('checks on the first call', () => {
    expect(dueForUpdateCheck({ ...base, lastCheckAt: 0, now: 1_000 })).toBe(true)
  })
})

describe('isUpdateAvailable', () => {
  it('offers a waiting worker on a controlled page', () => {
    expect(isUpdateAvailable({ waiting: true, controlled: true })).toBe(true)
  })

  it('ignores the first install', () => {
    expect(isUpdateAvailable({ waiting: true, controlled: false })).toBe(false)
  })

  it('ignores an install that is still running', () => {
    expect(isUpdateAvailable({ waiting: false, controlled: true })).toBe(false)
  })
})
