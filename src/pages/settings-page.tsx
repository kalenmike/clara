import { useNavigate } from 'react-router'
import { useTheme } from 'next-themes'
import { Check, Loader2, LogOut, Monitor, Moon, RefreshCw, Server, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { cn } from '@/lib/utils'

const SHORTCUTS: Array<[string, string]> = [
  ['ctrl+x then n', 'New session'],
  ['ctrl+x then l', 'Session list'],
  ['ctrl+x then m', 'Model picker'],
  ['ctrl+x then a', 'Agent picker'],
  ['ctrl+x then c', 'Compact session'],
  ['ctrl+x then s', 'Session info'],
  ['ctrl+x then g', 'Git changes'],
  ['ctrl+x then `', 'Pair terminal'],
  ['ctrl+x then h', 'Collapse messages'],
  ['ctrl+x then t', 'Toggle theme'],
  ['ctrl+x then y', 'Copy last reply'],
  ['tab / shift+tab', 'Cycle agent in the message box'],
  ['ctrl+. / ctrl+shift+.', 'Cycle agent from anywhere'],
  ['ctrl+t', 'Cycle model variant'],
  ['escape', 'Interrupt or close'],
  ['shift+enter', 'New line'],
]

export function SettingsPage() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { config, info, disconnect, reconnect, reconnecting, reconnectError } = useConnection()
  const { state: streamState, lastError } = useEventStream()

  const signOut = () => {
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
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Connection, appearance, notifications, sounds, and shortcuts.
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
            <Row label="URL" value={config?.baseUrl ?? 'not connected'} />
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
              <Button variant="outline" size="sm" onClick={signOut}>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Appearance</CardTitle>
            <CardDescription>Follow the system or force a theme.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            {[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Monitor },
            ].map((option) => (
              <Button
                key={option.value}
                variant="outline"
                size="sm"
                onClick={() => setTheme(option.value)}
                className={cn(theme === option.value && 'border-foreground/40 bg-accent')}
              >
                <option.icon className="size-4" />
                {option.label}
                {theme === option.value && <Check className="size-3.5" />}
              </Button>
            ))}
          </CardContent>
        </Card>

        <NotificationsCard />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
            <CardDescription>Based on the standard OpenCode keybinds.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {SHORTCUTS.map(([keys, action]) => (
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
