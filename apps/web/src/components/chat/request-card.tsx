import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RequestCardTone = 'primary' | 'sky' | 'amber'

const toneStyles: Record<RequestCardTone, { border: string; icon: string }> = {
  primary: { border: 'border-primary/30', icon: 'text-primary' },
  sky: { border: 'border-sky-500/30', icon: 'text-sky-500' },
  amber: { border: 'border-amber-500/30', icon: 'text-amber-500' },
}

/**
 * A request above the thread — plan handoff, saved draft, agent question, or
 * permission. It starts expanded, folds to a single header on click, and keeps
 * its own state for as long as the card is mounted.
 */
export function RequestCard({
  title,
  icon: Icon,
  tone = 'sky',
  badge,
  children,
}: {
  title: string
  icon: LucideIcon
  tone?: RequestCardTone
  badge?: ReactNode
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  const bodyID = useId()
  const styles = toneStyles[tone]

  return (
    <section
      aria-label={title}
      className={cn('mx-auto max-w-3xl rounded-xl border bg-card', styles.border)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyID}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded-xl p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
      >
        <Icon className={cn('size-4 shrink-0', styles.icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      <div
        id={bodyID}
        aria-hidden={!expanded}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!expanded}>
          <div className="px-3 pb-3 pl-9">{children}</div>
        </div>
      </div>
    </section>
  )
}
