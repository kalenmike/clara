import { ExternalLink, QrCode } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import { findFeature } from '../../lib/feature-control.ts'
import type { SetupState } from '../../lib/onboarding.ts'
import { BrowserPairCard } from '../browser-pair-card.tsx'
import { Badge, Notice } from '../primitives.tsx'

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
  const local = findFeature(snapshot.controls, 'local')
  const relay = findFeature(snapshot.controls, 'relay')
  const canPair =
    !snapshot.controls.stopped &&
    (setup.path === 'local' ? local.effective : local.effective || relay.effective)
  const devices = snapshot.devices.filter((device) => device.revokedAt === undefined)
  const webUrl = snapshot.config.pairingBaseUrl.value.replace(/\/+$/, '')
  const localDefault = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(webUrl)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Pair a client</h3>
        <p className="panel-muted mt-1 text-xs">
          Create a one-time link or QR code, then open it on the phone, tablet, or browser you want
          to use. The code enrolls one device.
        </p>
      </div>

      {devices.length > 0 ? (
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
          <a
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            className="panel-button mt-2 inline-flex"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Open Clara
          </a>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
          <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            No client is paired yet. Create a code below, or dismiss this setup and use Clients →
            Pair a browser later.
          </span>
        </div>
      )}

      {setup.path === 'local' && !local.effective ? (
        <Notice>
          Local transport is off, so a local pairing code cannot work. Turn it on from Network, or
          choose the relay path instead.
        </Notice>
      ) : null}

      {setup.path === 'local' && localDefault ? (
        <Notice>
          This pairing link points at loopback, so it only works on this machine. To pair another
          device, go back and set a Web URL the device can reach.
        </Notice>
      ) : null}

      <BrowserPairCard
        relayConfigured={snapshot.relay.configured}
        localAvailable={local.effective}
        canPair={canPair}
        now={now}
        onChanged={onChanged}
        initialTransport={setup.path === 'relay' ? 'relay' : 'local'}
        allowedTransports={setup.path === 'relay' ? ['relay', 'local'] : ['local']}
      />
    </div>
  )
}
