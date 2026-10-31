import { Link } from 'react-router'
import { CircleDot } from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SidebarSessionRow({
  session,
  projectID,
  selected,
  active,
  blocked,
  error,
  planReady,
  onNavigate,
}: {
  session: SessionInfo
  projectID: string
  selected: boolean
  active: boolean
  blocked: boolean
  error: boolean
  planReady: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      to={`/p/${projectID}/s/${session.id}`}
      onClick={onNavigate}
      className={cn(
        'group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent',
        selected && 'bg-sidebar-accent'
      )}
    >
      {blocked ? (
        <CircleDot className="mt-1 size-3 shrink-0 animate-pulse text-red-500" />
      ) : active ? (
        <CircleDot className="mt-1 size-3 shrink-0 animate-pulse text-emerald-500" />
      ) : error ? (
        <CircleDot className="mt-1 size-3 shrink-0 text-red-500" />
      ) : planReady ? (
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-orange-500" />
      ) : (
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {session.title || 'Untitled session'}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{session.agent ?? 'build'}</span>
          <span>·</span>
          <span className="truncate">{session.model?.id ?? 'default'}</span>
          <span>·</span>
          <span className="shrink-0">{formatRelativeTime(session.time.updated)}</span>
        </span>
      </span>
    </Link>
  )
}
