import { useCallback, useEffect, useRef, useState } from 'react'
import { withTimeout } from '@/lib/async'
import {
  CAMERA_PREVIEW_MESSAGE,
  CAMERA_STOPPED_MESSAGE,
  CAMERA_UNAVAILABLE_MESSAGE,
  SCAN_FAILED_MESSAGE,
  describeCameraError,
  isCameraScanningAvailable,
  isFrameReady,
  loadQrDecoder,
  type QrDecoder,
  type QrScanStage,
} from '@/lib/qr-scan'

const SCAN_INTERVAL_MS = 180
const MAX_FRAME_WIDTH = 640
/** Re-reading the same code should not repeat an invalid-QR message. */
const REPEAT_IGNORE_MS = 2_000
/** A camera prompt that never appears must not look like a slow one. */
const CAMERA_TIMEOUT_MS = 12_000
/** A granted stream can still never paint, notably on iOS after a resume. */
const PREVIEW_TIMEOUT_MS = 8_000
const DECODER_TIMEOUT_MS = 8_000

export type QrScanStatus = 'starting' | 'scanning' | 'error'

/**
 * Owns the camera stream and decodes frames locally. The caller decides
 * whether a value starts a pairing; returning false keeps the camera running
 * so another QR can be tried.
 *
 * The camera is requested before anything is awaited: iOS can skip the
 * permission prompt when the request is issued after slow async work. Every
 * stage has a deadline so a wedged request reports why instead of spinning.
 */
export function useQrScanner({
  active,
  onDetected,
}: {
  active: boolean
  onDetected: (value: string) => boolean
}) {
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const [videoAttached, setVideoAttached] = useState(false)
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoElRef.current = node
    setVideoAttached(node !== null)
  }, [])
  const onDetectedRef = useRef(onDetected)
  const [status, setStatus] = useState<QrScanStatus>('starting')
  const [stage, setStage] = useState<QrScanStage | null>('camera')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const retry = useCallback(() => {
    setError(null)
    setStatus('starting')
    setStage('camera')
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    const videoEl = videoElRef.current
    if (!active || !videoEl) return

    let cancelled = false
    let stream: MediaStream | null = null
    let frame = 0
    let run = 0
    let previewStartedAt = 0
    let lastScan = 0
    let lastValue = ''
    let lastValueAt = 0
    let decoding = false
    let decode: QrDecoder | null = null

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        stream = null
      }
      if (videoEl.srcObject) {
        videoEl.srcObject = null
        // iOS keeps a stopped capture pipeline attached to the element; a
        // reset load is what lets the next attempt use the camera again.
        videoEl.load()
      }
    }

    const fail = (message: string) => {
      if (cancelled) return
      stop()
      setStage(null)
      setError(message)
      setStatus('error')
    }

    const tick = (now: number) => {
      if (cancelled) return
      if (decoding) return
      frame = requestAnimationFrame(tick)
      if (!isFrameReady(videoEl)) {
        if (now - previewStartedAt > PREVIEW_TIMEOUT_MS) fail(CAMERA_PREVIEW_MESSAGE)
        return
      }
      if (now - lastScan < SCAN_INTERVAL_MS || !decode || !context) return
      lastScan = now

      const { videoWidth, videoHeight } = videoEl
      const scale = Math.min(1, MAX_FRAME_WIDTH / videoWidth)
      canvas.width = Math.max(1, Math.round(videoWidth * scale))
      canvas.height = Math.max(1, Math.round(videoHeight * scale))
      context.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const value = decode(image.data, image.width, image.height)
      if (!value) return
      if (value === lastValue && now - lastValueAt < REPEAT_IGNORE_MS) return
      lastValue = value
      lastValueAt = now

      let accepted: boolean
      try {
        accepted = onDetectedRef.current(value)
      } catch {
        fail(SCAN_FAILED_MESSAGE)
        return
      }
      if (accepted) {
        decoding = true
        stop()
      }
    }

    const handleTrackEnded = (media: MediaStream) => () => {
      // stop() ends tracks on purpose; only an unexpected end is a failure.
      if (cancelled || stream !== media) return
      fail(CAMERA_STOPPED_MESSAGE)
    }

    const start = async () => {
      const token = ++run
      setError(null)
      setStatus('starting')
      setStage('camera')
      if (!isCameraScanningAvailable() || !context) {
        fail(context ? CAMERA_UNAVAILABLE_MESSAGE : SCAN_FAILED_MESSAGE)
        return
      }

      // Nothing may be awaited before this call: the permission prompt is
      // tied to the tap that opened the scanner.
      const camera = navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const decoder = loadQrDecoder()

      let media: MediaStream
      try {
        media = await withTimeout(camera, CAMERA_TIMEOUT_MS, 'camera')
      } catch (cause) {
        // A request that outlived the deadline can still turn the camera on;
        // release it when it finally settles.
        void camera.then(
          (late) => {
            for (const track of late.getTracks()) track.stop()
          },
          () => undefined
        )
        if (cancelled || token !== run) return
        fail(describeCameraError(cause))
        return
      }
      if (cancelled || token !== run) {
        for (const track of media.getTracks()) track.stop()
        return
      }

      stream = media
      previewStartedAt = performance.now()
      videoEl.srcObject = media
      media.getVideoTracks()[0]?.addEventListener('ended', handleTrackEnded(media))
      setStage('preview')

      try {
        await withTimeout(videoEl.play(), PREVIEW_TIMEOUT_MS, 'preview')
      } catch (cause) {
        if (cancelled || token !== run) return
        fail(describeCameraError(cause))
        return
      }
      if (cancelled || token !== run) return

      setStage('decoder')
      try {
        decode = await withTimeout(decoder, DECODER_TIMEOUT_MS, 'decoder')
      } catch (cause) {
        if (cancelled || token !== run) return
        fail(describeCameraError(cause))
        return
      }
      if (cancelled || token !== run) return

      setStage(null)
      setStatus('scanning')
      frame = requestAnimationFrame(tick)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        run += 1
        stop()
        return
      }
      // iOS can leave the resumed pipeline dead; rebuild the element and stream.
      setAttempt((value) => value + 1)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void start()

    return () => {
      cancelled = true
      run += 1
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [active, attempt, videoAttached])

  return { videoRef, status, stage, error, retry, attempt }
}
