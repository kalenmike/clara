import type { FormEvent } from 'react'
import { Loader2, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function DirectForm({
  baseUrl,
  onBaseUrlChange,
  password,
  onPasswordChange,
  remember,
  onRememberChange,
  connecting,
  onSubmit,
}: {
  baseUrl: string
  onBaseUrlChange: (value: string) => void
  password: string
  onPasswordChange: (value: string) => void
  remember: boolean
  onRememberChange: (value: boolean) => void
  connecting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <label htmlFor="baseUrl" className="text-xs font-medium">
          Server URL
        </label>
        <Input
          id="baseUrl"
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="http://127.0.0.1:4096"
          autoComplete="url"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          The default port is 4096; background services use a random local port.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-xs font-medium">
          Password <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
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
          onChange={(event) => onRememberChange(event.target.checked)}
          className="size-3.5 accent-foreground"
        />
        Remember this connection on this device
      </label>

      <Button type="submit" className="w-full" disabled={connecting}>
        {connecting ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
        Connect
      </Button>
    </form>
  )
}
