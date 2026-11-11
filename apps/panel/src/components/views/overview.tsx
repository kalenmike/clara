import type { PanelEvent, PanelSnapshot, PanelStorageEntry } from '@clara/shared-types'
import type { PanelTab } from '../../lib/tabs.ts'
import { formatRelative } from '../../lib/format.ts'
import { buildHealth, needsAttention, storageHealth, type HealthTone } from '../../lib/health.ts'
import { PEEK_MASK } from '../../lib/peek.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { AgentCard } from '../overview-cards.tsx'
import { OrchestrationCard } from '../orchestration-card.tsx'
import { AttentionBanner, HealthTiles } from '../overview-health.tsx'
import { Badge, EmptyState, type Tone } from '../primitives.tsx'
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
  const health = buildHealth(snapshot)
  const attention = health.filter(needsAttention)

  return (
    <View
      id="overview"
      kicker="Hub"
      title="Overview"
      description="Live state of the hub, its harness, and the connections paired clients use."
    >
      <AttentionBanner items={attention} onSelect={onSelect} />

      <div className="grid items-start gap-3 md:grid-cols-2">
        <AgentCard
          agent={snapshot.agent}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
        />
        <OrchestrationCard
          orchestration={snapshot.controls.orchestration}
          onChanged={onChanged}
          defaultExpanded
        />
      </div>

      <HealthTiles items={health} onSelect={onSelect} />

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RecentActivity events={snapshot.events} now={now} onOpen={() => onSelect('activity')} />
        <StorageSummary storage={snapshot.storage} now={now} onOpen={() => onSelect('activity')} />
      </div>
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
    <section className="panel-card" aria-labelledby="overview-activity-title">
      <div className="panel-card-head flex items-center justify-between gap-2">
        <div>
          <h2 id="overview-activity-title" className="text-[13px] font-semibold">
            Recent activity
          </h2>
          <p className="panel-muted text-[11px]">In-memory events since the hub service started</p>
        </div>
        <button type="button" className="panel-link" onClick={onOpen}>
          View all
        </button>
      </div>
      <div className="p-3">
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
      </div>
    </section>
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
    <section className="panel-card" aria-labelledby="overview-storage-title">
      <div className="panel-card-head flex items-center justify-between gap-2">
        <div>
          <h2 id="overview-storage-title" className="text-[13px] font-semibold">
            Storage
          </h2>
          <p className="panel-muted text-[11px]" title={summary.title}>
            {summary.title}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <Badge tone={STORAGE_SUMMARY_TONE[summary.tone]}>{summary.label}</Badge>
          <button type="button" className="panel-link" onClick={onOpen}>
            View all
          </button>
        </span>
      </div>
      <div className="p-3">
        {storage.length === 0 ? (
          <EmptyState>No storage entries have been reported.</EmptyState>
        ) : issues.length === 0 ? (
          <p className="panel-muted text-xs">
            Every file the hub service reads or writes looks healthy.
          </p>
        ) : (
          <ul className="panel-mini-list">
            {issues.map((entry) => (
              <li key={entry.key} className="panel-mini-row">
                <span className="min-w-0 flex-1">
                  <strong className="font-medium">{entry.label}</strong>
                  <span className="panel-faint panel-mono block break-all text-[10px]">
                    {masked ? PEEK_MASK : entry.path}
                  </span>
                  {entry.detail ? (
                    <span className="panel-muted block text-[10px]">{redact(entry.detail)}</span>
                  ) : null}
                </span>
                <span className="panel-mini-time">{formatRelative(entry.modifiedAt, now)}</span>
                <Badge tone={STORAGE_TONE[entry.status]}>{entry.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
