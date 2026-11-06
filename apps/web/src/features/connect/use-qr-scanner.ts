import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CAMERA_UNAVAILABLE_MESSAGE,
  SCAN_FAILED_MESSAGE,
  describeCameraError,
  isCameraScanningAvailable,
  loadQrDecoder,
} from '@/lib/qr-scan'

const SCAN_INTERVAL_MS = 180
const MAX_FRAME_WIDTH = 640
/** Re-reading the same code should not repeat an invalid-QR message. */
const REPEAT_IGNORE_MS = 2_000

export type QrScanStatus = 'starting' | 'scanning' | 'error'

/**
 * Owns the camera stream and decodes frames locally. The caller decides
 * whether a value starts a pairing; returning false keeps the camera running
 * so another QR can be tried.
 */
export function useQrScanner({
  active,
  onDetected,
}: {
  active: boolean
  onDetected: (value: string) => boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onDetectedRef = useRef(onDetected)
  const [status, setStatus] = useState<QrScanStatus>('starting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const retry = useCallback(() => {
    setError(null)
    setStatus('starting')
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!active) return
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    let stream: MediaStream | null = null
    let frame = 0
    let lastScan = 0
    let lastValue = ''
    let lastValueAt = 0
    let decoding = false
    let decode: ((data: Uint8ClampedArray, width: number, height: number) => string | null) | null =
      null

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        stream = null
      }
      if (video.srcObject) video.srcObject = null
    }

    const fail = (message: string) => {
      if (cancelled) return
      stop()
      setError(message)
      setStatus('error')
    }

    const tick = (now: number) => {
      if (cancelled || decoding) return
      frame = requestAnimationFrame(tick)
      if (now - lastScan < SCAN_INTERVAL_MS || !decode || !context) return
      lastScan = now

      const { videoWidth, videoHeight } = video
      if (!videoWidth || !videoHeight) return

      const scale = Math.min(1, MAX_FRAME_WIDTH / videoWidth)
      canvas.width = Math.max(1, Math.round(videoWidth * scale))
      canvas.height = Math.max(1, Math.round(videoHeight * scale))
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
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

    const start = async () => {
      setError(null)
      setStatus('starting')
      if (!isCameraScanningAvailable() || !context) {
        fail(context ? CAMERA_UNAVAILABLE_MESSAGE : SCAN_FAILED_MESSAGE)
        return
      }

      try {
        decode = await loadQrDecoder()
        if (cancelled) return

        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          for (const track of media.getTracks()) track.stop()
          return
        }

        stream = media
        video.srcObject = media
        await video.play()
        if (cancelled) return

        setStatus('scanning')
        frame = requestAnimationFrame(tick)
      } catch (cause) {
        fail(describeCameraError(cause))
      }
    }

    void start()

    return () => {
      cancelled = true
      stop()
    }
  }, [active, attempt])

  return { videoRef, status, error, retry }
}
