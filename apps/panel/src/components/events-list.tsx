import { ScrollText } from 'lucide-react'
import type { PanelEvent } from '@clara/shared-types'
import { formatRelative, formatTimestamp } from '../lib/format.ts'
import { Badge, CardBody, CollapsibleCard, EmptyState, type Tone } from './primitives.tsx'

export function EventsCard({ events, now }: { events: PanelEvent[]; now: number }) {
  const newestFirst = [...events].reverse()
  return (
    <CollapsibleCard
      title="Recent activity"
      description="In-memory events since this agent started"
      icon={<ScrollText className="size-4" aria-hidden="true" />}
      action={<Badge tone="neutral">{events.length}</Badge>}
      defaultExpanded
    >
      <CardBody>
        {newestFirst.length === 0 ? (
          <EmptyState>No activity has been recorded yet.</EmptyState>
        ) : (
          <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {newestFirst.map((event, index) => (
              <li
                key={`${event.at}:${index}`}
                className="flex items-start gap-2 rounded-md border border-neutral-100 px-2.5 py-2 text-xs dark:border-neutral-800"
              >
                <Badge tone={toneFor(event.level)}>{event.level}</Badge>
                <span className="min-w-0 flex-1 break-words">{event.message}</span>
                <time
                  className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400"
                  dateTime={event.at}
                  title={formatTimestamp(event.at)}
                >
                  {formatRelative(event.at, now)}
                </time>
              </li>
            ))}
          </ol>
        )}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          The systemd journal keeps the durable log.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

function toneFor(level: PanelEvent['level']): Tone {
  switch (level) {
    case 'error':
      return 'danger'
    case 'warn':
      return 'warning'
    default:
      return 'neutral'
  }
}
