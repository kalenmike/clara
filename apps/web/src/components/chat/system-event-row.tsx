import { useState } from 'react'
import {
  ChevronRight,
  CircleHelp,
  CircleSlash,
  Hammer,
  Info,
  ListTodo,
  RefreshCw,
} from 'lucide-react'
import type { SystemEvent, SystemEventKind } from '@/features/chat/system-events'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A system row is a part of the transcript that did not come from a person
 * typing. It reads as a divider rather than a chat bubble.
 */
export function SystemEventRow({ event }: { event: SystemEvent }) {
  const [open, setOpen] = useState(false)
  const Icon = iconFor(event.kind)
  const detail = event.detail?.trim()
  const content = (
    <>
      <Icon className={cn('size-3 shrink-0', colorFor(event.kind))} aria-hidden="true" />
      <span className="min-w-0 truncate font-medium text-foreground/75">{event.label}</span>
      <span className="text-muted-foreground/50" aria-hidden="true">
        ·
      </span>
      <time
        className="shrink-0"
        dateTime={new Date(event.time).toISOString()}
        title={formatDateTime(event.time)}
      >
        {formatRelativeTime(event.time)}
      </time>
      {detail ? (
        <ChevronRight
          aria-hidden="true"
          className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
      ) : null}
    </>
  )

  return (
    <div className="px-3 py-2 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
        {detail ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex max-w-[min(34rem,80%)] items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9"
          >
            {content}
          </button>
        ) : (
          <div className="flex max-w-[min(34rem,80%)] items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
            {content}
          </div>
        )}
        <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
      </div>

      {detail && open ? (
        <div className="mx-auto mt-2 max-h-64 max-w-xl overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

function iconFor(kind: SystemEventKind) {
  switch (kind) {
    case 'plan-request':
      return ListTodo
    case 'plan-update':
      return RefreshCw
    case 'build-start':
      return Hammer
    case 'question-answer':
      return CircleHelp
    case 'question-dismissed':
      return CircleSlash
    case 'system-reminder':
      return Info
    default:
      return Info
  }
}

function colorFor(kind: SystemEventKind): string {
  switch (kind) {
    case 'build-start':
      return 'text-emerald-500'
    case 'plan-request':
    case 'plan-update':
    case 'question-answer':
      return 'text-sky-500'
    case 'question-dismissed':
      return 'text-muted-foreground/60'
    case 'system-reminder':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}
