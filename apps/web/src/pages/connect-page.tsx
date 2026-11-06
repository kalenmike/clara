import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Loader2, Server } from 'lucide-react'
import { parsePairingInput, type PairingPayload } from '@clara/shared-types'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { DirectForm } from '@/components/connect/direct-form'
import { ModeSwitch, type ConnectMode } from '@/components/connect/mode-switch'
import { PairForm } from '@/components/connect/pair-form'
import { QrScanDialog } from '@/components/connect/qr-scan-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useSessionWording } from '@/features/sessions/use-wording'
import { isRelayConfig, resolveRelayWsUrl } from '@/lib/client'
import { isCameraScanningAvailable } from '@/lib/qr-scan'
import { useConnection } from '@/providers/connection-provider'

export function ConnectPage() {
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const {
    status,
    error,
    attempt,
    booting,
    bootSource,
    localInfo,
    connect,
    connectLocal,
    relayStatus,
  } = useConnection()
  const attemptDirect = attempt && !isRelayConfig(attempt) ? attempt : null
  const [baseUrl, setBaseUrl] = useState(attemptDirect?.baseUrl ?? 'http://127.0.0.1:49374')
  const [password, setPassword] = useState(attemptDirect?.password ?? '')
  const [remember, setRemember] = useState(attemptDirect?.remember ?? false)
  const [pairCode, setPairCode] = useState('')
  const [pairError, setPairError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingPayload | null>(null)
  const [pickedMode, setPickedMode] = useState<ConnectMode | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const target = (location.state as { from?: string } | null)?.from ?? '/'
  const mode = pickedMode ?? (attemptDirect ? 'direct' : 'pair')
  const connecting = status === 'connecting'
  const canScan = isCameraScanningAvailable()

  const submitDirect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await connect({
      mode: 'direct',
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      password: password || undefined,
      remember,
      label: 'OpenCode server',
    })
  }

  const startPairing = async (payload: PairingPayload) => {
    setPairError(null)
    setPairing(payload)
    await connect({
      mode: 'relay',
      ...payload,
      wsUrl: resolveRelayWsUrl(payload.wsUrl, payload.room),
      remember: true,
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

  const useLocal = async () => {
    await connectLocal()
  }

  if (status === 'connected') return <Navigate to={target} replace />

  if (booting) {
    const label =
      bootSource === 'pairing-link' || attempt
        ? 'Connecting…'
        : bootSource === 'local'
          ? 'Checking for a local connection…'
          : 'Checking connection…'
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

        <Tabs
          value={mode}
          onValueChange={(value) => setPickedMode(value as ConnectMode)}
          className="gap-4"
        >
          <ModeSwitch />

          <TabsContent value="pair">
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
          </TabsContent>

          <TabsContent value="direct">
            <DirectForm
              baseUrl={baseUrl}
              onBaseUrlChange={setBaseUrl}
              password={password}
              onPasswordChange={setPassword}
              remember={remember}
              onRememberChange={setRemember}
              connecting={connecting}
              onSubmit={submitDirect}
            />
          </TabsContent>
        </Tabs>

        <QrScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onDetected={scanPairing}
          scanError={scanError}
          onScanRetry={() => setScanError(null)}
        />

        {localInfo && (
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <Server className="mt-0.5 size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Local OpenCode service detected</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Version {localInfo.version} · pid {localInfo.pid}
                </div>
              </div>
              <Button size="sm" onClick={useLocal} disabled={connecting}>
                {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
                Use local
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          The relay only sees encrypted frames. Your OpenCode password never leaves the home server.
        </p>
      </div>
    </div>
  )
}
