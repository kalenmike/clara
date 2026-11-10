import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError } from './async'
import {
  CAMERA_PREVIEW_MESSAGE,
  CAMERA_TIMEOUT_MESSAGE,
  CAMERA_UNAVAILABLE_MESSAGE,
  SCAN_FAILED_MESSAGE,
  describeCameraError,
  isCameraScanningAvailable,
  isFrameReady,
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

  it('names the stage that timed out', () => {
    expect(describeCameraError(new TimeoutError('camera'))).toBe(CAMERA_TIMEOUT_MESSAGE)
    expect(describeCameraError(new TimeoutError('preview'))).toBe(CAMERA_PREVIEW_MESSAGE)
    expect(describeCameraError(new TimeoutError('decoder'))).toBe(SCAN_FAILED_MESSAGE)
  })
})

describe('isFrameReady', () => {
  it('requires real frame dimensions and current data', () => {
    expect(isFrameReady({ videoWidth: 640, readyState: 4 })).toBe(true)
    expect(isFrameReady({ videoWidth: 640, readyState: 1 })).toBe(false)
    expect(isFrameReady({ videoWidth: 0, readyState: 4 })).toBe(false)
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
