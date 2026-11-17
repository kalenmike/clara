import { type ReactNode } from 'react'
import { Button } from '@clara/ui/components/button'
import { ArrowLeftRight, Cable, Cloud, ExternalLink, Laptop, Server } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import type { SetupState } from '../../lib/onboarding.ts'
import { Badge } from '../primitives.tsx'

const TAB_GUIDE = [
  ['Home', 'Hub health, transport status, and recent activity.'],
  ['Harness', 'Pair adapters, test a harness, and choose the active backend.'],
  ['Network', 'Local, relay, and push transports.'],
  ['Clients', 'Live browser sessions and paired devices.'],
  ['Traffic', 'Bytes, requests, and errors through the hub.'],
  ['Activity', 'In-memory events and storage health.'],
  ['Settings', 'Web URL, appearance, client sync, and reconfigure setup.'],
] as const

export function GuideStep({ snapshot, setup }: { snapshot: PanelSnapshot; setup: SetupState }) {
  const webUrl = snapshot.config.pairingBaseUrl.value.replace(/\/+$/, '')
  const pairedHarnesses = snapshot.harnesses.filter((harness) => !harness.forgottenAt).length
  const pathLabel =
    setup.path === 'relay'
      ? 'Remote via relay'
      : setup.path === 'local'
        ? 'Local only'
        : 'Not chosen'

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Setup complete</h3>
          <Badge tone="success">Ready</Badge>
        </div>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Connection path</dt>
            <dd className="font-medium">{pathLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Harness</dt>
            <dd className="font-medium">
              {pairedHarnesses > 0 ? `${pairedHarnesses} paired` : 'Not paired'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Clients</dt>
            <dd className="font-medium">
              {snapshot.devices.filter((device) => device.revokedAt === undefined).length} paired
            </dd>
          </div>
        </dl>
        <Button asChild variant="outline" className="mt-2">
          <a href={webUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Open Clara
          </a>
        </Button>
      </div>

      <div>
        <h3 className="text-sm font-semibold">How Clara works</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Clara has a hub on your machine, an adapter next to each harness, and paired clients that
          connect out to the hub.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted p-3">
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium">
          <DiagramNode icon={<Laptop className="size-3.5" />} label="Clients" />
          <ArrowLeftRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <DiagramNode icon={<Server className="size-3.5" />} label="Hub" />
          <ArrowLeftRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <DiagramNode icon={<Cable className="size-3.5" />} label="Adapter" />
          <ArrowLeftRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <DiagramNode icon={<Cable className="size-3.5" />} label="Harness" />
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <Cloud className="size-3.5" aria-hidden="true" />
          Optional relay for clients and adapters on another network. It sees encrypted frames only.
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Concept
          title="Hub"
          body="The service on this machine. It authenticates clients, stores pairings, and routes requests to adapters."
        />
        <Concept
          title="Harness"
          body="The agent server that runs sessions, such as OpenCode or Claude Code."
        />
        <Concept
          title="Adapter"
          body="The bridge on the harness machine. It connects out to the hub and holds the harness credentials."
        />
        <Concept
          title="Clients"
          body="Browsers and phones paired to the hub. Each device has its own key and can be revoked."
        />
      </div>

      <div>
        <h3 className="text-xs font-semibold">What each view is for</h3>
        <dl className="mt-1.5 divide-y divide-border rounded-lg border border-border text-[11px]">
          {TAB_GUIDE.map(([label, body]) => (
            <div key={label} className="flex gap-3 px-3 py-1.5">
              <dt className="w-20 shrink-0 font-medium">{label}</dt>
              <dd className="text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-muted-foreground text-[10px]">
        Keep the panel on loopback or behind an SSH tunnel. Pair devices from Clients; use the relay
        for remote access. Reconfigure this flow from Settings → Setup.
      </p>
    </div>
  )
}

function DiagramNode({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 ">
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </span>
  )
}

function Concept({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[11px] font-semibold">{title}</p>
      <p className="text-muted-foreground mt-0.5 text-[11px]">{body}</p>
    </div>
  )
}
