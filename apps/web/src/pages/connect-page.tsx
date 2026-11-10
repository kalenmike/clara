import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { parsePairingInput, type PairingPayload } from '@clara/shared-types'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { PairForm } from '@/components/connect/pair-form'
import { QrScanDialog } from '@/components/connect/qr-scan-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSessionWording } from '@/features/sessions/use-wording'
import { resolveRelayWsUrl } from '@/lib/client'
import { isCameraScanningAvailable } from '@/lib/qr-scan'
import { useConnection } from '@/providers/connection-provider'

export function ConnectPage() {
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const { status, error, attempt, booting, bootSource, connect, relayStatus } = useConnection()
  const [pairCode, setPairCode] = useState('')
  const [pairError, setPairError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingPayload | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const target = (location.state as { from?: string } | null)?.from ?? '/'
  const connecting = status === 'connecting'
  const canScan = isCameraScanningAvailable()

  const startPairing = async (payload: PairingPayload) => {
    setPairError(null)
    setPairing(payload)
    await connect({
      wsUrl: resolveRelayWsUrl(payload.wsUrl, payload.room),
      room: payload.room,
      clientToken: payload.clientToken,
      psk: payload.psk,
      fingerprint: payload.fingerprint,
      label: 'Clara server',
    })
  }

  const submitPair = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const payload = parsePairingInput(pairCode)
    if (!payload) {
      setPairError('That does not look like a Clara pairing code or link.')
      return
    }
    await startPairing(payload)
  }

  const scanPairing = (value: string): boolean => {
    const payload = parsePairingInput(value)
    if (!payload) {
      setScanError(
        'That QR code is not a Clara pairing code. Point the camera at the code printed by clara-server pair.'
      )
      return false
    }
    setScanError(null)
    setScanOpen(false)
    void startPairing(payload)
    return true
  }

  const openScanner = () => {
    setScanError(null)
    setScanOpen(true)
  }

  if (status === 'connected') return <Navigate to={target} replace />

  if (booting) {
    const label = bootSource === 'pairing-link' || attempt ? 'Connecting…' : 'Checking connection…'
    return <ConnectionSplash label={label} />
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <img src="/clara-mark.png" alt="" className="size-10 shrink-0" />
          <div>
            <img src="/clara-type.png" alt="Clara" className="h-5 w-auto" />
            <p className="text-xs text-muted-foreground">A web client for OpenCode {lowerPlural}</p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Connection failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <PairForm
          value={pairCode}
          onChange={(value) => {
            setPairCode(value)
            if (pairError) setPairError(null)
          }}
          error={pairError}
          pairing={pairing}
          relayStatus={relayStatus}
          connecting={connecting}
          canScan={canScan}
          onScan={openScanner}
          onSubmit={submitPair}
        />

        <QrScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onDetected={scanPairing}
          scanError={scanError}
          onScanRetry={() => setScanError(null)}
        />

        <p className="text-center text-[11px] text-muted-foreground">
          The relay only sees encrypted frames. Your OpenCode password never leaves the home server.
        </p>
      </div>
    </div>
  )
}
