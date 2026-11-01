import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptySessionView({
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  actionPending = false,
  footer,
}: {
  title: string
  description: string
  actionLabel?: string
  actionIcon?: ReactNode
  onAction?: () => void
  actionPending?: boolean
  footer?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <img src="/clara-mark.png" alt="" className="size-12 shrink-0" />
      <div className="max-w-sm">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button
          type="button"
          size="sm"
          className="max-md:h-11 max-md:px-4 max-md:text-sm"
          onClick={onAction}
          disabled={actionPending}
        >
          {actionPending ? <Loader2 className="size-4 animate-spin max-md:size-5" /> : actionIcon}
          {actionLabel}
        </Button>
      )}
      {footer}
    </div>
  )
}
