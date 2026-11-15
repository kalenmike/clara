import { ExternalLink, QrCode } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import type { PairingTransport } from '../../lib/client-pairing.ts'
import type { SetupState } from '../../lib/onboarding.ts'
import { useClientPairing } from '../../lib/use-client-pairing.ts'
import { PairClientContent, PairClientFooter } from '../pair-client-views.tsx'
import { Badge, Notice } from '../primitives.tsx'

const LOCAL_ONLY: PairingTransport[] = ['local']
const RELAY_AND_LOCAL: PairingTransport[] = ['relay', 'local']

export function ClientStep({
  snapshot,
  setup,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  setup: SetupState
  now: number
  onChanged: () => void
}) {
  const devices = snapshot.devices.filter((device) => device.revokedAt === undefined)
  const webUrl = snapshot.config.pairingBaseUrl.value.replace(/\/+$/, '')
  const localDefault = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(webUrl)
  const flow = useClientPairing({
    open: true,
    snapshot,
    now,
    onChanged,
    initialTransport: setup.path === 'relay' ? 'relay' : 'local',
    allowedTransports: setup.path === 'relay' ? RELAY_AND_LOCAL : LOCAL_ONLY,
  })

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Pair a client</h3>
        <p className="panel-muted mt-1 text-xs">
          Create a one-time link or QR code, then open it on the phone, tablet, or browser you want
          to use. The code enrolls one device.
        </p>
      </div>

      <PairedClients devices={devices} webUrl={webUrl} />

      {setup.path === 'local' && localDefault ? (
        <Notice>
          This pairing link points at loopback, so it only works on this machine. To pair another
          device, go back and set a Web URL the device can reach.
        </Notice>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="panel-setup-body">
          <PairClientContent flow={flow} now={now} />
        </div>
        <PairClientFooter flow={flow} />
      </div>
    </div>
  )
}

function PairedClients({ devices, webUrl }: { devices: PanelSnapshot['devices']; webUrl: string }) {
  if (devices.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-[11px] text-foreground">
        <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          No client is paired yet. Create a code below, or dismiss this setup and use Clients → Pair
          Client later.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Paired clients</p>
        <Badge tone="success">
          {devices.length} {devices.length === 1 ? 'device' : 'devices'}
        </Badge>
      </div>
      <ul className="mt-2 space-y-1">
        {devices.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-medium">{device.alias ?? device.label}</span>
            <span className="panel-muted font-mono">{device.id.slice(0, 8)}</span>
            <span className="panel-muted">{device.transport ?? 'not connected'}</span>
          </li>
        ))}
      </ul>
      <a href={webUrl} target="_blank" rel="noreferrer" className="panel-button mt-2 inline-flex">
        <ExternalLink className="size-3.5" aria-hidden="true" />
        Open Clara
      </a>
    </div>
  )
}
