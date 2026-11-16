import { useNavigate } from 'react-router'
import { Loader2, LogOut, RefreshCw, Server } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@clara/ui/components/alert'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import { Separator } from '@clara/ui/components/separator'
import { harnessHostSummary } from '@clara/shared-types'
import { useHarnesses } from '@/features/projects/use-projects'
import { connectionUrl } from '@/lib/client'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { usePush } from '@/providers/push-provider'

export function ServerCard({ simplified }: { simplified: boolean }) {
  const navigate = useNavigate()
  const { config, hub, disconnect, reconnect, reconnecting, reconnectError, relayStatus } =
    useConnection()
  const harnessesQuery = useHarnesses()
  const harnesses = harnessesQuery.data ?? []
  const { state: streamState, lastError } = useEventStream()
  const push = usePush()

  const signOut = async () => {
    await push.disable()
    disconnect()
    navigate('/connect', { replace: true })
  }

  const retry = async () => {
    const ok = await reconnect()
    if (ok) toast.success('Reconnected to the hub')
    else toast.error('Could not reach the Clara hub. Check that the hub service is running.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Server className="size-4" /> Server
        </CardTitle>
        {!simplified && (
          <CardDescription>The hub and harness this browser is connected to.</CardDescription>
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
            {relayStatus?.error && <Row label="Relay error" value={relayStatus.error} />}
            <Row
              label="Hub"
              value={hub ? `${hub.server.version} (PID ${hub.server.pid})` : 'unknown'}
            />
            <Row
              label="Harnesses"
              value={
                harnessesQuery.isPending
                  ? 'checking…'
                  : harnesses.length === 0
                    ? 'none paired'
                    : `${harnesses.filter((item) => item.online).length} of ${harnesses.length} online`
              }
            />
            {harnesses.map((harness) => {
              const host = harnessHostSummary(harness.host)
              return (
                <Row
                  key={harness.harnessID}
                  label={host ? `${harness.label} · ${host}` : harness.label}
                  value={harness.online ? 'online' : 'offline'}
                />
              )
            })}
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
