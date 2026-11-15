import type { KeyboardEvent, MouseEvent, Ref } from 'react'
import { Link } from 'react-router'
import type { ClaraSession } from '@clara/api-contract'
import { SessionStatusIcon } from '@/components/sessions/session-status-icon'
import type { SessionStatusKind } from '@/features/sessions/session-status'
import { useSessionWording } from '@/features/sessions/use-wording'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@clara/ui/lib/utils'

export function SidebarSessionRow({
  session,
  projectID,
  selected,
  bulkSelected,
  status,
  unread,
  onSelect,
  onExtend,
  onNavigate,
  linkRef,
}: {
  session: ClaraSession
  projectID: string
  selected: boolean
  bulkSelected: boolean
  status: SessionStatusKind
  unread: boolean
  onSelect: () => void
  onExtend: () => void
  onNavigate?: () => void
  linkRef?: Ref<HTMLAnchorElement>
}) {
  const { lowerSingular } = useSessionWording()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0) return

    if (event.shiftKey) {
      event.preventDefault()
      onExtend()
      return
    }

    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      onSelect()
      onNavigate?.()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onExtend()
    }
  }

  return (
    <Link
      ref={linkRef}
      to={`/p/${projectID}/s/${session.id}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-sidebar-session-id={session.id}
      aria-keyshortcuts="Shift+Enter"
      className={cn(
        'group flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:gap-2 md:px-2 md:py-1.5',
        selected && 'bg-sidebar-accent',
        bulkSelected &&
          'bg-destructive/10 ring-1 ring-inset ring-destructive/50 hover:bg-destructive/15'
      )}
    >
      <span className="flex h-5 w-4 shrink-0 items-center justify-center md:h-4 md:w-3">
        <SessionStatusIcon status={status} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm md:text-xs',
            unread ? 'font-semibold' : 'font-medium'
          )}
        >
          {session.title || `Untitled ${lowerSingular}`}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground md:text-[10px]">
          <span className="truncate">{session.agent ?? 'build'}</span>
          <span>·</span>
          <span className="truncate">{session.model?.id ?? 'default'}</span>
          <span>·</span>
          <span className="shrink-0">{formatRelativeTime(session.time.updated)}</span>
        </span>
      </span>
      {bulkSelected && <span className="sr-only">Selected for deletion</span>}
    </Link>
  )
}
