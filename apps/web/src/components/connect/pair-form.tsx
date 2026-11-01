import type { FormEvent } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import type { PairingPayload } from '@clara/shared-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RelayTransportStatus } from '@/lib/transport/relay'

export function PairForm({
  value,
  onChange,
  error,
  pairing,
  relayStatus,
  connecting,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
  pairing: PairingPayload | null
  relayStatus: RelayTransportStatus | null
  connecting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <label htmlFor="pairCode" className="text-xs font-medium">
          Pairing code or link
        </label>
        <Input
          id="pairCode"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="clara1_… or https://clara.kalenmichael.com/#pair=…"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Paste the code printed by <code>clara-server pair</code>. The key never leaves this
          browser.
        </p>
      </div>

      {pairing && (
        <div className="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          Key fingerprint <span className="font-mono text-foreground">{pairing.fingerprint}</span>
          {relayStatus ? ` · relay ${relayStatus.state}` : null}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Pairing code</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={connecting}>
        {connecting ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
        Pair with Clara server
      </Button>
    </form>
  )
}
