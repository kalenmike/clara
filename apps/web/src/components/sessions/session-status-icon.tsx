import { AlarmClock, CircleDot } from 'lucide-react'
import { SESSION_STATUS_LABELS, type SessionStatusKind } from '@/features/sessions/session-status'

/**
 * The one session status mark. Sidebar rows and composer tabs both render this
 * component so a running, blocked, failed, or finished session always looks the
 * same wherever it appears.
 */
export function SessionStatusIcon({ status }: { status: SessionStatusKind }) {
  const label = SESSION_STATUS_LABELS[status]

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center justify-center"
    >
      {status === 'snoozed' ? (
        <AlarmClock className="size-3.5 text-muted-foreground md:size-3" />
      ) : status === 'question' ? (
        <CircleDot className="size-3.5 animate-pulse text-red-500 md:size-3" />
      ) : status === 'active' ? (
        <CircleDot className="size-3.5 animate-pulse text-emerald-500 md:size-3" />
      ) : status === 'error' ? (
        <CircleDot className="size-3.5 text-red-500 md:size-3" />
      ) : (
        <span
          className={
            status === 'plan'
              ? 'size-2 rounded-full bg-orange-500 md:size-1.5'
              : 'size-2 rounded-full bg-muted-foreground/30 md:size-1.5'
          }
        />
      )}
    </span>
  )
}
