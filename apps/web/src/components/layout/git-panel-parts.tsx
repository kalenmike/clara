import type { ReactNode } from 'react'
import { GitBranch } from 'lucide-react'

export function GitPanelMessage({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <GitBranch className="size-5 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-[11px] font-medium">{title}</p>
        <p className="break-words text-[10px] text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
