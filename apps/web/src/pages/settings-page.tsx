import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Loader2, LogOut, RefreshCw, Server } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { ThemeCard } from '@/components/settings/theme-card'
import { WordingCard } from '@/components/settings/wording-card'
import { useSessionWording } from '@/features/sessions/use-wording'
import type { SessionWording } from '@/features/sessions/wording'
import { connectionUrl, isRelayConfig } from '@/lib/client'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { usePush } from '@/providers/push-provider'

function shortcutList(wording: SessionWording): Array<[string, string]> {
  return [
    ['ctrl+x then n', `New ${wording.lowerSingular}`],
    ['ctrl+x then l', `${wording.singular} list`],
    ['ctrl+x then m', 'Model picker'],
    ['ctrl+x then a', 'Agent picker'],
    ['ctrl+x then c', `Compact ${wording.lowerSingular}`],
    ['ctrl+x then s', `${wording.singular} info`],
    ['ctrl+x then g', 'Git changes'],
    ['ctrl+x then `', 'Pair terminal'],
    ['ctrl+x then h', 'Collapse messages'],
    ['ctrl+x then t', 'Toggle light/dark mode'],
    ['ctrl+x then y', 'Copy last reply'],
    ['tab / shift+tab', 'Cycle agent in the message box'],
    ['ctrl+. / ctrl+shift+.', 'Cycle agent from anywhere'],
    ['ctrl+t', 'Cycle model variant'],
    ['escape', 'Interrupt or close'],
    ['shift+enter', 'New line'],
  ]
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { config, info, disconnect, reconnect, reconnecting, reconnectError, relayStatus } =
    useConnection()
  const { state: streamState, lastError } = useEventStream()
  const push = usePush()
  const wording = useSessionWording()
  const shortcuts = shortcutList(wording)

  const signOut = async () => {
    await push.disable()
    disconnect()
    navigate('/connect', { replace: true })
  }

  const retry = async () => {
    const ok = await reconnect()
    if (ok) toast.success('Reconnected to OpenCode')
    else toast.error('Could not reach the server. Check that OpenCode is running.')
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <Link
            to="/"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Connection, appearance, wording, notifications, sounds, and shortcuts.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4" /> Server
            </CardTitle>
            <CardDescription>The OpenCode instance this browser is connected to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="URL" value={connectionUrl(config)} />
            <Row label="Mode" value={config && isRelayConfig(config) ? 'E2EE relay' : 'direct'} />
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void retry()}
                disabled={reconnecting}
              >
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

        <ThemeCard />

        <WordingCard />

        <NotificationsCard />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
            <CardDescription>Based on the standard OpenCode keybinds.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {shortcuts.map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{action}</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
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
