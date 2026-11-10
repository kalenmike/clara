import type { Ref } from 'react'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { useSessionWording } from '@/features/sessions/use-wording'

export function SidebarSelectionBar({
  selectedSessions,
  failureNote,
  onClear,
  onDelete,
  clearRef,
}: {
  selectedSessions: readonly SessionInfo[]
  failureNote: string | null
  onClear: () => void
  onDelete: () => void
  clearRef?: Ref<HTMLButtonElement>
}) {
  const { lowerSingular, lowerPlural } = useSessionWording()

  if (selectedSessions.length === 0) return null

  const count =
    selectedSessions.length === 1
      ? `1 ${lowerSingular} selected`
      : `${selectedSessions.length} ${lowerPlural} selected`

  return (
    <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border bg-sidebar-accent/40 px-2.5 py-2">
      <div
        role="status"
        aria-live="polite"
        className="min-w-0 flex-1 space-y-0.5 text-[11px] leading-tight md:text-[10px]"
      >
        <span className="block font-medium text-foreground">{count}</span>
        <span className="block text-muted-foreground">Press Delete or Backspace to delete</span>
        {failureNote && <span className="block text-destructive">{failureNote}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2 md:gap-1">
        <Button
          ref={clearRef}
          variant="ghost"
          size="xs"
          onClick={onClear}
          className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
        >
          Clear
        </Button>
        <Button
          variant="destructive"
          size="xs"
          onClick={onDelete}
          aria-label={`Delete selected ${lowerPlural}`}
          className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
