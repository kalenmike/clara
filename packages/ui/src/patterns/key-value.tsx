import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function KeyValue({
  label,
  children,
  mono = false,
  title,
  className,
  valueClassName,
}: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
  title?: string
  className?: string
  valueClassName?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0',
        className
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 break-words text-right text-foreground',
          mono && 'font-mono text-xs',
          valueClassName
        )}
        title={title}
      >
        {children}
      </span>
    </div>
  )
}
