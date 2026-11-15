import { useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '../components/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { cn } from '../lib/utils'

export function SectionCard({
  title,
  description,
  icon,
  control,
  notice,
  collapsible = false,
  defaultOpen = false,
  open,
  onOpenChange,
  as = 'div',
  className,
  headerClassName,
  contentClassName,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  control?: ReactNode
  notice?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  as?: 'div' | 'section' | 'aside'
  className?: string
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}) {
  const contentId = useId()
  const heading = (
    <div className="min-w-0 flex-1">
      {title ? (
        <div className="flex flex-wrap items-center gap-2 text-base leading-snug font-medium">
          {title}
          {collapsible ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground transition group-data-[state=open]/trigger:rotate-180"
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : null}
      {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )

  const header = (
    <div
      className={cn('flex items-start justify-between gap-3 px-(--card-spacing)', headerClassName)}
    >
      {collapsible ? (
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-controls={contentId}
            className="group/trigger flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
            {heading}
          </button>
        </CollapsibleTrigger>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
          {heading}
        </div>
      )}
      {control ? <div className="shrink-0">{control}</div> : null}
    </div>
  )

  const body = (
    <>
      {notice}
      <div className={cn('px-(--card-spacing)', contentClassName)}>{children}</div>
    </>
  )

  const content = collapsible ? (
    <CollapsibleContent id={contentId}>{body}</CollapsibleContent>
  ) : (
    body
  )

  const card =
    as === 'div' ? (
      <Card className={className}>
        {header}
        {content}
      </Card>
    ) : (
      <Card asChild>
        {as === 'section' ? (
          <section className={className}>
            {header}
            {content}
          </section>
        ) : (
          <aside className={className}>
            {header}
            {content}
          </aside>
        )}
      </Card>
    )

  return collapsible ? (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange}>
      {card}
    </Collapsible>
  ) : (
    card
  )
}
