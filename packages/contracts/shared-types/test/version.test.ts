import { describe, expect, it } from 'vitest'
import {
  claraVersionLabel,
  compareVersions,
  isAdapterUpdateAvailable,
  isDevelopmentVersion,
} from '../src/version.ts'

describe('claraVersionLabel', () => {
  it('names each surface and keeps the version intact', () => {
    expect(claraVersionLabel('web', '0.1.0-dev+abc1234')).toBe('Clara Web · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('pwa', '0.1.0-dev+abc1234')).toBe('Clara PWA · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('desktop', '0.1.0-dev+abc1234')).toBe(
      'Clara Desktop · 0.1.0-dev+abc1234'
    )
    expect(claraVersionLabel('hub', '0.1.0-dev+abc1234')).toBe('Clara Hub · 0.1.0-dev+abc1234')
    expect(claraVersionLabel('lab', '0.1.0-dev+abc1234')).toBe('Clara Lab · 0.1.0-dev+abc1234')
  })

  it('preserves a release version without a dev suffix', () => {
    expect(claraVersionLabel('hub', '1.2.3')).toBe('Clara Hub · 1.2.3')
  })
})

describe('adapter update versions', () => {
  it('recognises development builds', () => {
    expect(isDevelopmentVersion('0.1.0-dev+abc1234')).toBe(true)
    expect(isDevelopmentVersion('0.1.0-dev')).toBe(true)
    expect(isDevelopmentVersion('0.1.0-beta.1')).toBe(false)
    expect(isDevelopmentVersion('0.1.0')).toBe(false)
  })

  it('orders releases and prereleases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0)
  })

  it('uses release timestamps for dev builds with the same core', () => {
    expect(
      isAdapterUpdateAvailable({
        current: '0.1.0-dev+7572258',
        latest: '0.1.0-dev+8809f65',
        currentAt: '2026-11-16T16:34:03Z',
        latestAt: '2026-11-16T23:09:22Z',
      })
    ).toBe(true)
    expect(
      isAdapterUpdateAvailable({
        current: '0.1.0-dev+8809f65',
        latest: '0.1.0-dev+7572258',
        currentAt: '2026-11-16T23:09:22Z',
        latestAt: '2026-11-16T16:34:03Z',
      })
    ).toBe(false)
  })

  it('treats differing dev builds without timestamps as an update', () => {
    expect(
      isAdapterUpdateAvailable({
        current: '0.1.0-dev+fff0000',
        latest: '0.1.0-dev+000ffff',
      })
    ).toBe(true)
  })

  it('keeps semantic ordering when a core version changes', () => {
    expect(
      isAdapterUpdateAvailable({
        current: '0.1.0-dev+fff0000',
        latest: '0.2.0-dev+000ffff',
        currentAt: '2026-11-16T23:00:00Z',
        latestAt: '2026-11-16T16:00:00Z',
      })
    ).toBe(true)
    expect(
      isAdapterUpdateAvailable({
        current: '0.2.0-dev+000ffff',
        latest: '0.1.0-dev+fff0000',
        currentAt: '2026-11-16T16:00:00Z',
        latestAt: '2026-11-16T23:00:00Z',
      })
    ).toBe(false)
  })

  it('does not update an identical or missing version', () => {
    expect(
      isAdapterUpdateAvailable({
        current: '0.1.0-dev+abc1234',
        latest: '0.1.0-dev+abc1234',
        currentAt: '2026-11-16T16:00:00Z',
        latestAt: '2026-11-16T23:00:00Z',
      })
    ).toBe(false)
    expect(isAdapterUpdateAvailable({ current: undefined, latest: '0.1.0' })).toBe(false)
    expect(isAdapterUpdateAvailable({ current: '0.1.0', latest: undefined })).toBe(false)
  })
})
