import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAMERA_UNAVAILABLE_MESSAGE,
  SCAN_FAILED_MESSAGE,
  describeCameraError,
  isCameraScanningAvailable,
  loadQrDecoder,
} from './qr-scan'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('describeCameraError', () => {
  it('asks for camera permission when access is blocked', () => {
    expect(describeCameraError({ name: 'NotAllowedError' })).toContain('Allow camera access')
    expect(describeCameraError({ name: 'SecurityError' })).toContain('Allow camera access')
  })

  it('points at paste when no usable camera exists', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toContain('Paste the pairing code')
    expect(describeCameraError({ name: 'OverconstrainedError' })).toContain(
      'Paste the pairing code'
    )
  })

  it('reports a camera held by another app', () => {
    expect(describeCameraError({ name: 'NotReadableError' })).toContain('another app')
  })

  it('falls back to the scanner message for unknown failures', () => {
    expect(describeCameraError(new Error('boom'))).toBe(SCAN_FAILED_MESSAGE)
    expect(describeCameraError('nope')).toBe(SCAN_FAILED_MESSAGE)
  })
})

describe('isCameraScanningAvailable', () => {
  it('requires a secure context and a media device API', () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => undefined } })
    expect(isCameraScanningAvailable()).toBe(true)

    vi.stubGlobal('window', { isSecureContext: false })
    expect(isCameraScanningAvailable()).toBe(false)

    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', {})
    expect(isCameraScanningAvailable()).toBe(false)
  })
})

describe('loadQrDecoder', () => {
  it('loads the decoder once and returns a function', async () => {
    const decoder = await loadQrDecoder()
    expect(decoder).toBeTypeOf('function')
    expect(await loadQrDecoder()).toBe(decoder)
    expect(CAMERA_UNAVAILABLE_MESSAGE).toContain('HTTPS')
  })
})
