import { Loader2, QrCode, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useQrScanner } from '@/features/connect/use-qr-scanner'

export function QrScanDialog({
  open,
  onOpenChange,
  onDetected,
  scanError,
  onScanRetry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDetected: (value: string) => boolean
  scanError: string | null
  onScanRetry: () => void
}) {
  const { videoRef, status, error, retry } = useQrScanner({ active: open, onDetected })

  const retryScan = () => {
    onScanRetry()
    retry()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-4" />
            Scan pairing QR
          </DialogTitle>
          <DialogDescription>
            Point the camera at the QR code printed by <code>clara-server pair</code>. The code is
            decoded on this device and never uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            aria-hidden
            className="size-full object-cover"
            muted
            playsInline
            autoPlay
          />

          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="aspect-square w-3/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          </div>

          {status === 'starting' && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <span className="flex items-center gap-2 text-xs text-white">
                <Loader2 className="size-4 animate-spin" />
                Starting camera…
              </span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center text-xs text-white">
              {error}
            </div>
          )}
        </div>

        <div aria-live="polite" className="px-4">
          {status === 'error' ? (
            <p className="text-center text-xs text-muted-foreground">
              Camera scanning is unavailable right now.
            </p>
          ) : scanError ? (
            <Alert variant="destructive">
              <AlertTitle>Not a Clara pairing code</AlertTitle>
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {status === 'scanning'
                ? 'Looking for a Clara pairing code…'
                : 'Allow camera access to start scanning.'}
            </p>
          )}
        </div>

        <DialogFooter className="p-4 pt-0">
          {status === 'error' && (
            <Button type="button" variant="outline" className="max-md:h-11" onClick={retryScan}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="max-md:h-11"
            onClick={() => onOpenChange(false)}
          >
            Paste a code instead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
