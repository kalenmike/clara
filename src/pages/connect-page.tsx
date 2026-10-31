import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Loader2, PlugZap, Server, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useConnection } from '@/providers/connection-provider'

export function ConnectPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const { status, error, attempt, localInfo, connect, connectLocal } = useConnection()
  const [baseUrl, setBaseUrl] = useState(attempt?.baseUrl ?? 'http://127.0.0.1:49374')
  const [password, setPassword] = useState(attempt?.password ?? '')
  const [remember, setRemember] = useState(attempt?.remember ?? false)

  const target = (location.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    if (status === 'connected') navigate(target, { replace: true })
  }, [status, navigate, target])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const ok = await connect({
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      password: password || undefined,
      remember,
      label: 'OpenCode server',
    })
    if (ok) navigate(target, { replace: true })
  }

  const useLocal = async () => {
    const ok = await connectLocal()
    if (ok) navigate(target, { replace: true })
  }

  if (status === 'connected') return <Navigate to={target} replace />

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Clara</h1>
            <p className="text-xs text-muted-foreground">A web client for OpenCode {lowerPlural}</p>
          </div>
        </div>

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
              <Button size="sm" onClick={useLocal} disabled={status === 'connecting'}>
                {status === 'connecting' ? <Loader2 className="size-4 animate-spin" /> : null}
                Use local
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">Connect to a server</h2>
            <p className="text-xs text-muted-foreground">
              Point Clara at a running OpenCode 2 server. The default port is 4096; background
              services use a random local port.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="baseUrl" className="text-xs font-medium">
              Server URL
            </label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:4096"
              autoComplete="url"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-medium">
              Password <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="From ~/.local/state/opencode/service.json"
              autoComplete="current-password"
            />
            <p className="text-[11px] text-muted-foreground">
              OpenCode uses HTTP basic auth with the <code>opencode</code> user.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="size-3.5 accent-foreground"
            />
            Remember this connection on this device
          </label>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Connection failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={status === 'connecting'}>
            {status === 'connecting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            Connect
          </Button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground">
          Remote server? Start OpenCode with{' '}
          <code className="rounded bg-muted px-1 py-0.5">
            opencode serve --cors {window.location.origin}
          </code>
        </p>
      </div>
    </div>
  )
}
