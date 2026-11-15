import type { ComponentProps } from 'react'
import { Badge } from '../components/badge'
import { cn } from '../lib/utils'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  danger: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
}

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
  info: 'bg-status-info',
}

export function StatusBadge({
  tone = 'neutral',
  dot = true,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant'> & {
  tone?: StatusTone
  dot?: boolean
}) {
  return (
    <Badge variant="outline" className={cn('gap-1.5', TONE_CLASSES[tone], className)} {...props}>
      {dot ? (
        <span className={cn('size-1.5 rounded-full', DOT_CLASSES[tone])} aria-hidden="true" />
      ) : null}
      {children}
    </Badge>
  )
}
