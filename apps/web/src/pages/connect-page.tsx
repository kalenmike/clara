import { Navigate, useLocation } from 'react-router'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { PairForm } from '@/components/connect/pair-form'
import { QrScanDialog } from '@/components/connect/qr-scan-dialog'
import { AppFooter } from '@/components/pwa/app-footer'
import { Alert, AlertDescription, AlertTitle } from '@clara/ui/components/alert'
import { usePairingForm } from '@/features/pairing/use-pairing-form'
import { useSessionWording } from '@/features/sessions/use-wording'
import { isCameraScanningAvailable } from '@/lib/qr-scan'
import { useConnection } from '@/providers/connection-provider'

export function ConnectPage() {
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const { status, error, attempt, booting, bootSource, relayStatus } = useConnection()
  const form = usePairingForm()

  const target = (location.state as { from?: string } | null)?.from ?? '/'
  const connecting = status === 'connecting'
  const canScan = isCameraScanningAvailable()

  if (status === 'connected') return <Navigate to={target} replace />

  if (booting) {
    const label = bootSource === 'pairing-link' || attempt ? 'Connecting…' : 'Checking connection…'
    return <ConnectionSplash label={label} />
  }

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg space-y-6">
            <div className="flex items-center gap-3">
              <img src="/clara-mark.png" alt="" className="size-10 shrink-0" />
              <div>
                <img src="/clara-type.png" alt="Clara" className="h-5 w-auto" />
                <p className="text-xs text-muted-foreground">A web client for your {lowerPlural}</p>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Connection failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <PairForm
              value={form.value}
              onChange={form.changeValue}
              error={form.error}
              pairing={form.pairing}
              relayStatus={relayStatus}
              connecting={connecting}
              canScan={canScan}
              onScan={form.openScanner}
              onSubmit={form.submit}
            />

            <QrScanDialog
              open={form.scanOpen}
              onOpenChange={form.setScanOpen}
              onDetected={form.scan}
              scanError={form.scanError}
              onScanRetry={form.resetScanError}
            />

            <p className="text-center text-[11px] text-muted-foreground">
              The relay only sees encrypted frames. Your harness credentials never leave the home
              server.
            </p>
          </div>
        </div>

        <AppFooter />
      </div>
    </div>
  )
}
