import { describe, expect, it } from 'vitest'
import { urlBase64ToUint8Array } from './push'

describe('urlBase64ToUint8Array', () => {
  it('decodes unpadded base64url for the VAPID application server key', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255])
    expect([...urlBase64ToUint8Array('AQI=')]).toEqual([1, 2])
  })
})
