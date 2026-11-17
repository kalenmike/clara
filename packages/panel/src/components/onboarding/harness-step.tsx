import { Cable } from 'lucide-react'
import { harnessHostSummary, type PanelSnapshot } from '@clara/shared-types'
import { findFeature } from '../../lib/feature-control.ts'
import { useHarnessPairing } from '../../lib/use-harness-pairing.ts'
import { HarnessPairContent, HarnessPairFooter } from '../harness-pair-views.tsx'
import { Badge, Notice } from '../primitives.tsx'

export function HarnessStep({
  snapshot,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
}) {
  const feature = findFeature(snapshot.controls, 'opencode')
  const flow = useHarnessPairing({
    open: true,
    snapshot,
    now,
    onChanged,
  })
  const activeHarnesses = snapshot.harnesses.filter((harness) => !harness.forgottenAt)
  const online = activeHarnesses.filter((harness) => harness.online).length

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Connect a harness</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          An adapter runs next to the harness and connects out to this hub. The hub never contacts
          the harness directly.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted p-3 text-[11px] text-foreground">
        <p className="flex items-center gap-1.5 font-semibold">
          <Cable className="size-3.5" aria-hidden="true" />
          What is a harness?
        </p>
        <p className="mt-1">
          It is the agent server that runs your sessions. This release includes OpenCode 2.1.x,
          Claude Code 2.1.325, and Pi 1.5.x adapters. Choose the harness you run, then install the
          adapter on the machine that runs it.
        </p>
      </div>

      {!feature.desired ? (
        <Notice>
          Harness access is off. Turn it on from the Harness view before pairing an adapter.
        </Notice>
      ) : null}

      {activeHarnesses.length > 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold">Paired harnesses</p>
            <Badge tone={online > 0 ? 'success' : 'warning'}>
              {online} of {activeHarnesses.length} online
            </Badge>
          </div>
          <ul className="mt-2 space-y-1">
            {activeHarnesses.map((harness) => (
              <li key={harness.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-medium">{harness.label}</span>
                {harnessHostSummary(harness.host) ? (
                  <span className="text-muted-foreground">{harnessHostSummary(harness.host)}</span>
                ) : null}
                <span className="text-muted-foreground">{harness.kind}</span>
                <Badge tone={harness.online ? 'success' : 'warning'}>
                  {harness.online ? 'Online' : 'Paired · Offline'}
                </Badge>
              </li>
            ))}
          </ul>
          {online === 0 ? (
            <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
              The adapter is paired but not online. Start the adapter service on the harness
              machine. You can continue and fix it later.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="panel-setup-body">
          <HarnessPairContent flow={flow} now={now} />
        </div>
        <HarnessPairFooter flow={flow} />
      </div>
    </div>
  )
}
