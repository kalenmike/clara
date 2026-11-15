import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-3.5 text-center text-sm text-muted-foreground',
        className
      )}
    >
      {icon ? <span className="[&_svg]:size-4">{icon}</span> : null}
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      {description ? <p>{description}</p> : null}
      {children ? <p>{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
