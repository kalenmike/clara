export type QrDecoder = (data: Uint8ClampedArray, width: number, height: number) => string | null

export const CAMERA_UNAVAILABLE_MESSAGE =
  'Camera scanning needs HTTPS and a browser with camera support. Paste the pairing code instead.'

export const SCAN_FAILED_MESSAGE = 'The scanner could not start. Paste the pairing code instead.'

let decoderPromise: Promise<QrDecoder> | null = null

/**
 * The decoder is small but only useful on the connect screen. Load it when a
 * scan starts so the app shell and the paste form stay untouched.
 */
export function loadQrDecoder(): Promise<QrDecoder> {
  decoderPromise ??= import('jsqr').then(({ default: jsQR }) => {
    return (data, width, height) => {
      const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
      return result?.data ?? null
    }
  })
  return decoderPromise
}

export function isCameraScanningAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!window.isSecureContext) return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * Camera failures arrive as DOMException names in the browser and as plain
 * objects in tests. Map both to copy the connect screen can show.
 */
export function describeCameraError(error: unknown): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow camera access for Clara and try again. On iPhone, enable Camera for this app in Settings.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'No usable camera was found on this device. Paste the pairing code instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app. Close it and try again.'
    case 'AbortError':
      return 'The camera stopped before it could start. Try again.'
    default:
      return SCAN_FAILED_MESSAGE
  }
}

function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) return ''
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}
