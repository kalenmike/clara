import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  GitFork,
  Home,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SessionInfo } from '@opencode/client'
import { useMobileActions } from '@/components/layout/mobile-actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useCompactSession, useInterruptSession } from '@/features/chat/use-chat'
import { useSessionCost } from '@/features/cost/use-session-cost'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import {
  useArchiveSession,
  useDeleteSession,
  useRenameSession,
  useSnoozeSession,
} from '@/features/sessions/use-sessions'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { formatCost, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ChatHeader({
  session,
  snapshot,
  infoOpen,
  onToggleInfo,
  onFork,
  forkPending,
  onDeleted,
  allCollapsed,
  canToggleAll,
  onToggleAll,
  showInternal,
  onToggleInternal,
  worker,
}: {
  session: SessionInfo | undefined
  snapshot: ChatSnapshot
  infoOpen: boolean
  onToggleInfo: () => void
  onFork: () => void
  forkPending: boolean
  onDeleted: () => void
  allCollapsed: boolean
  canToggleAll: boolean
  onToggleAll: () => void
  showInternal: boolean
  onToggleInternal: () => void
  worker?: boolean
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(session?.title ?? '')
  const interrupt = useInterruptSession(session?.id ?? '')
  const compact = useCompactSession(session?.id ?? '')
  const rename = useRenameSession(session?.id ?? '')
  const archive = useArchiveSession(session?.id ?? '')
  const snooze = useSnoozeSession()
  const remove = useDeleteSession()
  const { singular, lowerSingular } = useSessionWording()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const mobileActions = useMobileActions()

  const busy = snapshot.status.type !== 'idle'
  const archived = session != null && isArchivedSession(session)
  const snoozed = session != null && isSnoozedSession(session)
  const cost = useSessionCost(session, snapshot)

  const toggleSnooze = () => {
    if (!session) return
    snooze.mutate(
      { session, snoozed: !snoozed },
      {
        onSuccess: () => toast.success(snoozed ? `${singular} unsnoozed` : `${singular} snoozed`),
        onError: () =>
          toast.error(
            snoozed
              ? `Could not unsnooze the ${lowerSingular}`
              : `Could not snooze the ${lowerSingular}`
          ),
      }
    )
  }

  const copyID = async () => {
    if (!session) return
    await navigator.clipboard.writeText(session.id)
  }

  const deleteSession = () => {
    if (!session) return
    if (!window.confirm(`Delete this ${lowerSingular} and all of its messages?`)) return
    remove.mutate(session.id, { onSuccess: onDeleted })
  }

  const actions = (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleInternal}
        aria-pressed={showInternal}
        title={showInternal ? 'Hide internal messages' : 'Show internal messages'}
        className={cn('size-8 max-md:size-11', showInternal && 'bg-accent')}
      >
        {showInternal ? (
          <Eye className="size-4 max-md:size-5" />
        ) : (
          <EyeOff className="size-4 max-md:size-5" />
        )}
        <span className="sr-only">
          {showInternal ? 'Hide internal messages' : 'Show internal messages'}
        </span>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleAll}
        disabled={!canToggleAll}
        aria-pressed={allCollapsed}
        className="size-8 max-md:size-11"
      >
        {allCollapsed ? (
          <ChevronsUpDown className="size-4 max-md:size-5" />
        ) : (
          <ChevronsDownUp className="size-4 max-md:size-5" />
        )}
        <span className="sr-only">
          {allCollapsed ? 'Expand all messages' : 'Collapse all messages'}
        </span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 max-md:size-11">
            <MoreHorizontal className="size-4 max-md:size-5" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={copyID}>
            <Copy className="size-3.5" /> Copy {lowerSingular} ID
          </DropdownMenuItem>
          {!worker && (
            <>
              <DropdownMenuItem onSelect={onFork} disabled={forkPending}>
                <GitFork className="size-3.5" /> Fork {lowerSingular}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => compact.mutate()}>
                <PanelRight className="size-3.5" /> Compact context
              </DropdownMenuItem>
            </>
          )}
          {session && !archived && !worker && (
            <DropdownMenuItem onSelect={toggleSnooze} disabled={snooze.isPending}>
              {snoozed ? (
                <AlarmClockOff className="size-3.5" />
              ) : (
                <AlarmClock className="size-3.5" />
              )}
              {snoozed ? 'Remove from Snoozed' : `Snooze ${lowerSingular}`}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => archive.mutate(true)}>
            <Archive className="size-3.5" /> Archive {lowerSingular}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteSession} className="text-destructive">
            <Trash2 className="size-3.5" /> Delete {lowerSingular}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleInfo}
        className={cn('size-8 max-md:size-11', infoOpen && 'bg-accent')}
      >
        <PanelRight className="size-4 max-md:size-5" />
        <span className="sr-only">Toggle side panel</span>
      </Button>
    </>
  )

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b px-2 md:px-3">
      <Button asChild variant="ghost" size="icon" className="size-8 max-md:size-11">
        <Link to="/" title="Back to start">
          <Home className="size-4 max-md:size-5" />
          <span className="sr-only">Back to start</span>
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            setTitle(session?.title ?? '')
            setRenameOpen(true)
          }}
          className="flex w-full min-w-0 items-center gap-1 text-left"
        >
          <span className="truncate text-sm font-medium">
            {session?.title || `Untitled ${lowerSingular}`}
          </span>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:opacity-100 md:opacity-0" />
        </button>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className={cn(busy && 'text-emerald-500')}>{statusLabel(snapshot)}</span>
          <span title={cost.estimated ? 'Estimated from model prices' : undefined}>
            · {formatCost(cost.value, { estimated: cost.estimated })}
          </span>
          <span className="hidden sm:inline">
            · {formatTokens((snapshot.tokens ?? session?.tokens)?.input)} in /{' '}
            {formatTokens((snapshot.tokens ?? session?.tokens)?.output)} out
          </span>
        </div>
      </div>

      {busy && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => interrupt.mutate()}
          disabled={interrupt.isPending}
          className="gap-1.5 max-md:h-11 max-md:min-w-11"
        >
          <Square className="size-3.5 max-md:size-5" />
          <span className="hidden sm:inline">Stop</span>
        </Button>
      )}

      {isDesktop && actions}
      {!isDesktop && mobileActions.node != null && createPortal(actions, mobileActions.node)}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {lowerSingular}</DialogTitle>
            <DialogDescription>
              Give this {lowerSingular} a short, searchable title.
            </DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <DialogFooter>
            <Button
              variant="outline"
              className="max-md:h-11 max-md:px-4 max-md:text-sm"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="max-md:h-11 max-md:px-4 max-md:text-sm"
              onClick={() => rename.mutate(title.trim(), { onSuccess: () => setRenameOpen(false) })}
              disabled={!title.trim() || rename.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}

function statusLabel(snapshot: ChatSnapshot): string {
  if (snapshot.status.type === 'busy') return 'running'
  if (snapshot.status.type === 'retry') return `retry ${snapshot.status.attempt}`
  return 'idle'
}
