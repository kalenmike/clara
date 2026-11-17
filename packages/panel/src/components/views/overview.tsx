import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@clara/ui/components/card'
import type { PanelEvent, PanelSnapshot, PanelStorageEntry } from '@clara/shared-types'
import type { PanelTab } from '../../lib/tabs.ts'
import { formatRelative } from '../../lib/format.ts'
import { needsAttention, overviewHealth, storageHealth, type HealthTone } from '../../lib/health.ts'
import { PEEK_MASK } from '../../lib/peek.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { HubPowerButton } from '../hub-power-button.tsx'
import { HarnessPairDialog } from '../harness-pair-dialog.tsx'
import { ActiveAdaptersCard, ActiveClientsCard } from '../overview-connections.tsx'
import { AttentionBanner, HealthTiles } from '../overview-health.tsx'
import { PairClientDialog } from '../pair-client-dialog.tsx'
import { Badge, CardLink, EmptyState, Notice, type Tone } from '../primitives.tsx'
import { View } from '../shell/view.tsx'

const EVENT_TONE: Record<PanelEvent['level'], Tone> = {
  info: 'neutral',
  warn: 'warning',
  error: 'danger',
}

const STORAGE_TONE: Record<PanelStorageEntry['status'], Tone> = {
  ok: 'success',
  warn: 'warning',
  error: 'danger',
  missing: 'warning',
}

const STORAGE_SUMMARY_TONE: Record<HealthTone, Tone> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'neutral',
}

export function OverviewView({
  snapshot,
  now,
  onChanged,
  onSelect,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onSelect: (tab: PanelTab) => void
}) {
  const health = overviewHealth(snapshot)
  const attention = health.filter(needsAttention)
  const [powerError, setPowerError] = useState<string>()
  const [pairClientOpen, setPairClientOpen] = useState(false)
  const [pairHarnessOpen, setPairHarnessOpen] = useState(false)
  const { redact } = usePeek()
  const browserClients = snapshot.clients.filter((client) => client.kind !== 'adapter')
  const adapterClients = snapshot.clients.filter((client) => client.kind === 'adapter')

  return (
    <View
      id="overview"
      kicker="Hub"
      title="Overview"
      description="Live state of the hub, its harness, and the connections paired clients use."
      actions={
        <HubPowerButton
          stopped={snapshot.agent.stopped}
          onChanged={onChanged}
          onError={setPowerError}
        />
      }
    >
      {powerError ? <Notice tone="danger">{redact(powerError)}</Notice> : null}

      <AttentionBanner items={attention} onSelect={onSelect} />

      <HealthTiles items={health} onSelect={onSelect} />

      <div className="grid items-stretch gap-3 md:grid-cols-2">
        <ActiveClientsCard
          clients={browserClients}
          devices={snapshot.devices}
          now={now}
          onOpen={() => onSelect('clients')}
          onPair={() => setPairClientOpen(true)}
        />
        <ActiveAdaptersCard
          clients={adapterClients}
          harnesses={snapshot.harnesses}
          now={now}
          onOpen={() => onSelect('harness')}
          onPair={() => setPairHarnessOpen(true)}
        />
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-2">
        <RecentActivity events={snapshot.events} now={now} onOpen={() => onSelect('activity')} />
        <StorageSummary storage={snapshot.storage} now={now} onOpen={() => onSelect('activity')} />
      </div>

      <PairClientDialog
        open={pairClientOpen}
        snapshot={snapshot}
        now={now}
        onChanged={onChanged}
        onClose={() => setPairClientOpen(false)}
      />
      <HarnessPairDialog
        open={pairHarnessOpen}
        snapshot={snapshot}
        now={now}
        onChanged={onChanged}
        onClose={() => setPairHarnessOpen(false)}
      />
    </View>
  )
}

function RecentActivity({
  events,
  now,
  onOpen,
}: {
  events: PanelEvent[]
  now: number
  onOpen: () => void
}) {
  const { redact } = usePeek()
  const recent = [...events].reverse().slice(0, 5)

  return (
    <Card asChild>
      <section aria-labelledby="overview-activity-title">
        <CardHeader className="flex items-center justify-between gap-2">
          <div>
            <h2 id="overview-activity-title" className="text-sm font-semibold">
              Recent activity
            </h2>
            <p className="text-[11px] text-muted-foreground">
              In-memory events since the hub service started
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState>No activity has been recorded yet.</EmptyState>
          ) : (
            <ol className="panel-mini-list">
              {recent.map((event, index) => (
                <li key={`${event.at}:${index}`} className="panel-mini-row">
                  <Badge tone={EVENT_TONE[event.level]}>{event.level}</Badge>
                  <span className="min-w-0 flex-1 break-words">{redact(event.message)}</span>
                  <time className="panel-mini-time" dateTime={event.at}>
                    {formatRelative(event.at, now)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
        <CardLink onClick={onOpen}>View all</CardLink>
      </section>
    </Card>
  )
}

function StorageSummary({
  storage,
  now,
  onOpen,
}: {
  storage: PanelStorageEntry[]
  now: number
  onOpen: () => void
}) {
  const summary = storageHealth(storage)
  const { masked, redact } = usePeek()
  const issues = storage.filter((entry) => entry.status !== 'ok').slice(0, 4)

  return (
    <Card asChild>
      <section aria-labelledby="overview-storage-title">
        <CardHeader className="flex items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="overview-storage-title" className="text-sm font-semibold">
                Storage
              </h2>
              <Badge tone={STORAGE_SUMMARY_TONE[summary.tone]}>{summary.label}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground" title={summary.title}>
              {summary.title}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {storage.length === 0 ? (
            <EmptyState>No storage entries have been reported.</EmptyState>
          ) : issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every file the hub service reads or writes looks healthy.
            </p>
          ) : (
            <ul className="panel-mini-list">
              {issues.map((entry) => (
                <li key={entry.key} className="panel-mini-row">
                  <span className="min-w-0 flex-1">
                    <strong className="font-medium">{entry.label}</strong>
                    <span className="text-muted-foreground/70 font-mono block break-all text-[10px]">
                      {masked ? PEEK_MASK : entry.path}
                    </span>
                    {entry.detail ? (
                      <span className="block text-[10px] text-muted-foreground">
                        {redact(entry.detail)}
                      </span>
                    ) : null}
                  </span>
                  <span className="panel-mini-time">{formatRelative(entry.modifiedAt, now)}</span>
                  <Badge tone={STORAGE_TONE[entry.status]}>{entry.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardLink onClick={onOpen}>View all</CardLink>
      </section>
    </Card>
  )
}
