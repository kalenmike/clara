import { useNavigate } from 'react-router'
import { Loader2, LogOut, RefreshCw, Server } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { connectionUrl } from '@/lib/client'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { usePush } from '@/providers/push-provider'

export function ServerCard({ simplified }: { simplified: boolean }) {
  const navigate = useNavigate()
  const { config, info, disconnect, reconnect, reconnecting, reconnectError, relayStatus } =
    useConnection()
  const { state: streamState, lastError } = useEventStream()
  const push = usePush()

  const signOut = async () => {
    await push.disable()
    disconnect()
    navigate('/connect', { replace: true })
  }

  const retry = async () => {
    const ok = await reconnect()
    if (ok) toast.success('Reconnected to OpenCode')
    else toast.error('Could not reach the Clara hub. Check that the hub service is running.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Server className="size-4" /> Server
        </CardTitle>
        {!simplified && (
          <CardDescription>The OpenCode instance this browser is connected to.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!simplified && (
          <>
            <Row label="URL" value={connectionUrl(config)} />
            <Row
              label="Transport"
              value={config ? (config.room === 'local' ? 'Local WebSocket' : 'E2EE relay') : '—'}
            />
            {relayStatus && <Row label="Relay" value={relayStatus.state} />}
            {relayStatus?.agent?.opencodeVersion && (
              <Row label="OpenCode" value={relayStatus.agent.opencodeVersion} />
            )}
            <Row label="Version" value={info?.version ?? 'unknown'} />
            <Row label="PID" value={info ? String(info.pid) : 'unknown'} />
            <Row label="URLs" value={info?.urls.join(', ') ?? 'unknown'} />
            <Row label="Stream" value={streamState} />
            {lastError && <Row label="Stream error" value={lastError} />}
            <Separator />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void retry()} disabled={reconnecting}>
            {reconnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Reconnect
          </Button>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOut className="size-4" /> Disconnect
          </Button>
        </div>
        {reconnectError && (
          <Alert variant="destructive">
            <AlertTitle>Reconnect failed</AlertTitle>
            <AlertDescription>{reconnectError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[70%] truncate text-right font-mono text-xs">{value}</span>
    </div>
  )
}
