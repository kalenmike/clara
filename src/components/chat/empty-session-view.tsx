import type { ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptySessionView({
  projectName,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  actionPending = false,
}: {
  projectName?: string
  title: string
  description: string
  actionLabel?: string
  actionIcon?: ReactNode
  onAction?: () => void
  actionPending?: boolean
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border bg-card">
        <Sparkles className="size-5 text-muted-foreground" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {projectName && (
          <p className="mt-3 truncate font-mono text-[11px] text-muted-foreground">{projectName}</p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button type="button" size="sm" onClick={onAction} disabled={actionPending}>
          {actionPending ? <Loader2 className="size-4 animate-spin" /> : actionIcon}
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
