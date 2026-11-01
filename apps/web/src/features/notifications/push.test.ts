import { describe, expect, it } from 'vitest'
import { describePushError, urlBase64ToUint8Array } from './push'

const BRAVE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Brave/1.71.118'
const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

describe('describePushError', () => {
  it('points Brave users at the push messaging setting', () => {
    const cause = new DOMException('Registration failed - push service error', 'AbortError')
    const message = describePushError(cause, BRAVE_UA)

    expect(message).toContain('Use Google services for push messaging')
    expect(message).toContain('brave://settings/privacy')
  })

  it('keeps the generic hint for other browsers', () => {
    const cause = new DOMException('Registration failed - push service error', 'AbortError')
    const message = describePushError(cause, CHROME_UA)

    expect(message).toContain('push service is unavailable')
    expect(message).not.toContain('brave://')
  })

  it('recognises the older push service message', () => {
    const cause = new Error('Registration failed - push service not available')

    expect(describePushError(cause, BRAVE_UA)).toContain('brave://settings/privacy')
  })

  it('passes unrelated failures through unchanged', () => {
    expect(describePushError(new Error('The Clara transport is not connected'))).toBe(
      'The Clara transport is not connected'
    )
  })

  it('falls back for a thrown value without a message', () => {
    expect(describePushError('')).toBe('Push notifications could not be enabled')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes unpadded base64url for the VAPID application server key', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255])
    expect([...urlBase64ToUint8Array('AQI=')]).toEqual([1, 2])
  })
})
