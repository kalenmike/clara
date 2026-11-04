import { Brain } from 'lucide-react'
import { formatUsageSummary, type UsageSummary } from '@/features/chat/usage-summary'

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
  return (
    <div className="px-4 py-2 text-xs text-muted-foreground sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Brain aria-hidden="true" className="size-3 shrink-0" />
        <span className="inline-flex items-center gap-1.5">
          {streaming ? (
            <span className="size-1.5 animate-pulse rounded-full bg-foreground/50" />
          ) : null}
          <span>{streaming ? 'Thinking…' : 'Thinking'}</span>
        </span>
        <span>{formatUsageSummary(summary)}</span>
      </div>
    </div>
  )
}
