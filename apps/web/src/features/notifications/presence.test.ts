import { describe, expect, it } from 'vitest'
import { detectDeviceClass, shouldHoldPhone } from './presence'

describe('detectDeviceClass', () => {
  it('prefers the User-Agent Client Hints signal', () => {
    expect(
      detectDeviceClass({
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        userAgentData: { mobile: false },
      })
    ).toBe('desktop')
    expect(
      detectDeviceClass({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        userAgentData: { mobile: true },
      })
    ).toBe('mobile')
  })

  it('falls back to the user agent', () => {
    expect(detectDeviceClass({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })).toBe(
      'mobile'
    )
    expect(detectDeviceClass({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 9)' })).toBe(
      'mobile'
    )
    expect(detectDeviceClass({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('desktop')
  })

  it('treats a touch Mac as an iPad', () => {
    expect(
      detectDeviceClass({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe('mobile')
  })

  it('defaults to desktop without a navigator', () => {
    expect(detectDeviceClass(undefined)).toBe('desktop')
  })
})

describe('shouldHoldPhone', () => {
  const base = {
    deviceClass: 'desktop' as const,
    visible: true,
    canAlert: true,
    idleMs: 1_000,
    deskIdleMs: 300_000,
  }

  it('holds while a desktop client is visible and recently active', () => {
    expect(shouldHoldPhone(base)).toBe(true)
  })

  it('releases when idle beyond the window', () => {
    expect(shouldHoldPhone({ ...base, idleMs: 300_001 })).toBe(false)
    expect(shouldHoldPhone({ ...base, idleMs: 300_000 })).toBe(true)
  })

  it('does not hold for mobile, hidden, or mute devices', () => {
    expect(shouldHoldPhone({ ...base, deviceClass: 'mobile' })).toBe(false)
    expect(shouldHoldPhone({ ...base, visible: false })).toBe(false)
    expect(shouldHoldPhone({ ...base, canAlert: false })).toBe(false)
  })
})
