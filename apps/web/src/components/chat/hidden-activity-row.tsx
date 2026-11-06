import { Brain } from 'lucide-react'
import { formatUsageDetail, type UsageSummary } from '@/features/chat/usage-summary'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Closes a turn that ended on hidden work. The next visible reply normally
 * carries the rolled-up usage, but there is no reply to attach it to here.
 */
export function HiddenActivityRow({
  summary,
  streaming,
}: {
  summary: UsageSummary
  streaming: boolean
}) {
  const chars = summary.chars > 0 ? `(${formatCount(summary.chars)} chars)` : null
  const detail = formatUsageDetail(summary)

  return (
    <div className={cn('px-4 text-xs text-muted-foreground sm:px-6', !streaming && 'py-2')}>
      {streaming ? <TypingDots /> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Brain aria-hidden="true" className="size-3 shrink-0" />
        <span>
          Thinking{chars ? ` ${chars}` : ''}
          {detail ? ` · ${detail}` : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * The three-dot indicator that precedes a live thinking footer, so the row
 * reads as work in progress rather than a finished summary.
 */
function TypingDots() {
  return (
    <span aria-hidden="true" className="my-4 flex items-center gap-1 pl-0.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="clara-typing-dot size-1.5 rounded-full bg-foreground/60"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  )
}
