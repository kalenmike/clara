import { describe, expect, it } from 'vitest'
import {
  APPLIED_GUARD_MS,
  dueForUpdateCheck,
  FOCUS_CHECK_INTERVAL_MS,
  IDLE_CHECK_INTERVAL_MS,
  isRecentlyApplied,
  isUpdateAvailable,
  shouldOfferUpdate,
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

describe('shouldOfferUpdate', () => {
  const running = { id: 'abc123', at: '2026-11-14T10:00:00.000Z' }

  it('offers a worker that cannot report its build', () => {
    expect(shouldOfferUpdate({ running, waiting: null })).toBe(true)
  })

  it('offers a newer build', () => {
    expect(
      shouldOfferUpdate({
        running,
        waiting: { id: 'def456', at: '2026-11-14T11:00:00.000Z' },
      })
    ).toBe(true)
  })

  it('ignores a worker of the same build', () => {
    expect(
      shouldOfferUpdate({
        running,
        waiting: { id: running.id, at: '2026-11-14T11:00:00.000Z' },
      })
    ).toBe(false)
  })

  it('ignores a worker built before the running page', () => {
    expect(
      shouldOfferUpdate({
        running,
        waiting: { id: 'def456', at: '2026-11-14T09:00:00.000Z' },
      })
    ).toBe(false)
  })

  it('ignores a worker built at the same time', () => {
    expect(shouldOfferUpdate({ running, waiting: { id: 'def456', at: running.at } })).toBe(false)
  })

  it('offers a different build when the timestamps are unusable', () => {
    expect(
      shouldOfferUpdate({
        running: { id: 'abc123', at: 'not-a-date' },
        waiting: { id: 'def456', at: 'also-not-a-date' },
      })
    ).toBe(true)
  })
})

describe('isRecentlyApplied', () => {
  const applied = { id: 'abc123', at: 1_000_000 }

  it('ignores a build this page just applied', () => {
    expect(isRecentlyApplied({ applied, buildId: 'abc123', now: applied.at + 1_000 })).toBe(true)
  })

  it('stops ignoring it once the guard expires', () => {
    expect(
      isRecentlyApplied({ applied, buildId: 'abc123', now: applied.at + APPLIED_GUARD_MS })
    ).toBe(false)
  })

  it('does not match another build', () => {
    expect(isRecentlyApplied({ applied, buildId: 'def456', now: applied.at + 1_000 })).toBe(false)
  })

  it('does nothing without a stored or reported build', () => {
    expect(isRecentlyApplied({ applied: null, buildId: 'abc123', now: 1 })).toBe(false)
    expect(isRecentlyApplied({ applied, buildId: null, now: 1 })).toBe(false)
  })
})
