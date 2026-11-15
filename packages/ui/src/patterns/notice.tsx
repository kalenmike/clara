import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils'

export type NoticeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<NoticeTone, string> = {
  neutral: 'border-border bg-muted text-foreground',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  danger: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
}

const ICONS = {
  neutral: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
} as const

export function Notice({
  tone = 'warning',
  title,
  className,
  children,
}: {
  tone?: NoticeTone
  title?: ReactNode
  className?: string
  children: ReactNode
}) {
  const Icon = ICONS[tone]

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        TONE_CLASSES[tone],
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  )
}
