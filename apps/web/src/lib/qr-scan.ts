export type QrDecoder = (data: Uint8ClampedArray, width: number, height: number) => string | null

/** What the scanner is waiting on while the dialog shows its starting state. */
export type QrScanStage = 'camera' | 'preview' | 'decoder'

/**
 * Ask the camera for real sensor pixels. A relay pairing link carries a
 * one-time enrollment grant and renders as a dense code; a default 640-wide
 * preview leaves it too few pixels per module to decode.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
}

/** Frames larger than this are scaled down before the decoder sees them. */
export const MAX_DECODE_WIDTH = 1280

/**
 * One frame is decoded per tick, cycling through these crops. The full frame
 * catches a code anywhere in view; the center crops hand the decoder native
 * pixels instead of a downscaled frame, which is what a dense code needs. The
 * ratios stay ordered from widest to tightest.
 */
const DECODE_CROP_RATIOS = [1, 0.6, 0.35] as const

export type DecodeRegion = {
  /** Source rectangle in video pixels. */
  source: { x: number; y: number; width: number; height: number }
  /** Canvas size the region is drawn at, never wider than MAX_DECODE_WIDTH. */
  width: number
  height: number
}

/**
 * The regions the scanner samples, widest first. A crop keeps the sensor
 * pixels it covers, so a code that is small in the frame still resolves once
 * the scanner reaches a tight crop.
 */
export function decodeRegions(videoWidth: number, videoHeight: number): DecodeRegion[] {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return []
  return DECODE_CROP_RATIOS.map((ratio) => {
    const width = Math.max(1, Math.round(videoWidth * ratio))
    const height = Math.max(1, Math.round(videoHeight * ratio))
    const scale = Math.min(1, MAX_DECODE_WIDTH / width)
    return {
      source: {
        x: Math.round((videoWidth - width) / 2),
        y: Math.round((videoHeight - height) / 2),
        width,
        height,
      },
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  })
}

export const CAMERA_UNAVAILABLE_MESSAGE =
  'Camera scanning needs HTTPS and a browser with camera support. Paste the pairing code instead.'

export const SCAN_FAILED_MESSAGE = 'The scanner could not start. Paste the pairing code instead.'

export const CAMERA_TIMEOUT_MESSAGE =
  'The camera did not respond. On iPhone, allow camera access for this site in Settings → Safari → Camera, close Clara from the app switcher, and try again. Paste the pairing code instead.'

export const CAMERA_PREVIEW_MESSAGE =
  'The camera opened but produced no picture. Close Clara from the app switcher and reopen it; if that does not help, restart the iPhone. Paste the pairing code instead.'

export const CAMERA_STOPPED_MESSAGE =
  'The camera stopped. Close the scanner and try again. Paste the pairing code instead.'

const CAMERA_BLOCKED_MESSAGE =
  'Camera access is blocked. Allow camera access for this site in your browser settings, or in Settings → Safari → Camera on iPhone, then try again.'

let decoderPromise: Promise<QrDecoder> | null = null

/**
 * The decoder is small but only useful on the connect screen. Load it when a
 * scan starts so the app shell and the paste form stay untouched. A failed
 * import clears the cache so retrying can fetch the chunk again.
 */
export function loadQrDecoder(): Promise<QrDecoder> {
  decoderPromise ??= import('jsqr')
    .then(({ default: jsQR }) => {
      return (data: Uint8ClampedArray, width: number, height: number) => {
        const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
        return result?.data ?? null
      }
    })
    .catch((cause: unknown) => {
      decoderPromise = null
      throw cause
    })
  return decoderPromise
}

export function isCameraScanningAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!window.isSecureContext) return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * A camera can deliver a track whose video element never paints: common on
 * iOS after an installed app resumes. Waiting for real frame dimensions keeps
 * the dialog from reporting success over a black rectangle.
 */
export function isFrameReady(video: { videoWidth: number; readyState: number }): boolean {
  return video.videoWidth > 0 && video.readyState >= 2
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
      return CAMERA_BLOCKED_MESSAGE
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
    case 'TimeoutError':
      return timeoutMessage(error)
    default:
      return SCAN_FAILED_MESSAGE
  }
}

function timeoutMessage(error: unknown): string {
  const label = timeoutLabel(error)
  if (label === 'camera') return CAMERA_TIMEOUT_MESSAGE
  if (label === 'preview') return CAMERA_PREVIEW_MESSAGE
  return SCAN_FAILED_MESSAGE
}

function timeoutLabel(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('label' in error)) return ''
  const label = (error as { label?: unknown }).label
  return typeof label === 'string' ? label : ''
}

function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) return ''
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}
