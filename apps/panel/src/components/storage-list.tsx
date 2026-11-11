import { HardDrive } from 'lucide-react'
import type { PanelStorageEntry } from '@clara/shared-types'
import { formatBytes, formatRelative, formatTimestamp, healthLabel } from '../lib/format.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, type Tone } from './primitives.tsx'
import { storageHealth, type HealthTone } from '../lib/health.ts'

const SUMMARY_TONE: Record<HealthTone, Tone> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'neutral',
}

export function StorageCard({
  storage,
  now,
  defaultExpanded = false,
}: {
  storage: PanelStorageEntry[]
  now: number
  defaultExpanded?: boolean
}) {
  const summary = storageHealth(storage)
  const { masked, redact } = usePeek()
  return (
    <CollapsibleCard
      title="Storage"
      description="Files the agent reads and writes, never their contents"
      icon={<HardDrive className="size-4" aria-hidden="true" />}
      defaultExpanded={defaultExpanded}
      action={
        <span title={summary.title}>
          <Badge tone={SUMMARY_TONE[summary.tone]}>{summary.label}</Badge>
        </span>
      }
    >
      <CardBody>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {storage.map((entry) => (
            <li key={entry.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.label}</span>
                    <Badge tone={toneFor(entry.status)}>{healthLabel(entry.status)}</Badge>
                    <span
                      className={`text-[11px] ${entry.writable ? 'text-neutral-500 dark:text-neutral-400' : 'text-amber-700 dark:text-amber-300'}`}
                    >
                      {entry.writable ? 'writable' : 'read-only'}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                    {masked ? PEEK_MASK : entry.path}
                  </p>
                  {entry.detail ? (
                    <p className={`mt-1 text-xs ${detailClass(entry.status)}`}>
                      {redact(entry.detail)}
                    </p>
                  ) : null}
                  {entry.sync ? (
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      {entry.sync.namespaces} namespace(s) · {entry.sync.liveEntries} synced
                      value(s) · {entry.sync.tombstones} tombstone(s) ·{' '}
                      {formatBytes(entry.sync.bytes)} of sync data
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-[11px] text-neutral-500 dark:text-neutral-400">
                  {entry.schemaVersion !== undefined ? (
                    <div className="font-mono">schema v{entry.schemaVersion}</div>
                  ) : null}
                  {entry.mode ? <div className="font-mono">mode {entry.mode}</div> : null}
                  {entry.bytes !== undefined ? <div>{formatBytes(entry.bytes)}</div> : null}
                  {entry.modifiedAt ? (
                    <div title={formatTimestamp(entry.modifiedAt)}>
                      {formatRelative(entry.modifiedAt, now)}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </CollapsibleCard>
  )
}

function toneFor(status: PanelStorageEntry['status']): Tone {
  switch (status) {
    case 'ok':
      return 'success'
    case 'warn':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'neutral'
  }
}

function detailClass(status: PanelStorageEntry['status']): string {
  switch (status) {
    case 'error':
      return 'text-red-700 dark:text-red-300'
    case 'warn':
      return 'text-amber-700 dark:text-amber-300'
    default:
      return 'text-neutral-500 dark:text-neutral-400'
  }
}
