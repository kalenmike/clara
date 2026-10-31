import { useState } from 'react'
import { Link } from 'react-router'
import {
  Archive,
  ArrowLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
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
import {
  useArchiveSession,
  useDeleteSession,
  useRenameSession,
} from '@/features/sessions/use-sessions'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { formatCost, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ChatHeader({
  session,
  snapshot,
  projectID,
  infoOpen,
  onToggleInfo,
  onDeleted,
  allCollapsed,
  canToggleAll,
  onToggleAll,
  showInternal,
  onToggleInternal,
}: {
  session: SessionInfo | undefined
  snapshot: ChatSnapshot
  projectID: string
  infoOpen: boolean
  onToggleInfo: () => void
  onDeleted: () => void
  allCollapsed: boolean
  canToggleAll: boolean
  onToggleAll: () => void
  showInternal: boolean
  onToggleInternal: () => void
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(session?.title ?? '')
  const interrupt = useInterruptSession(session?.id ?? '')
  const compact = useCompactSession(session?.id ?? '')
  const rename = useRenameSession(session?.id ?? '')
  const archive = useArchiveSession(session?.id ?? '')
  const remove = useDeleteSession()

  const busy = snapshot.status.type !== 'idle'

  const copyID = async () => {
    if (!session) return
    await navigator.clipboard.writeText(session.id)
  }

  const deleteSession = () => {
    if (!session) return
    if (!window.confirm('Delete this session and all of its messages?')) return
    remove.mutate(session.id, { onSuccess: onDeleted })
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b px-2 md:px-3">
      <Button asChild variant="ghost" size="icon" className="size-8 md:hidden">
        <Link to={`/p/${projectID}`}>
          <ArrowLeft className="size-4" />
          <span className="sr-only">Back to sessions</span>
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            setTitle(session?.title ?? '')
            setRenameOpen(true)
          }}
          className="flex min-w-0 items-center gap-1 text-left"
        >
          <span className="truncate text-sm font-medium">
            {session?.title || 'Untitled session'}
          </span>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:opacity-100 md:opacity-0" />
        </button>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className={cn(busy && 'text-emerald-500')}>{statusLabel(snapshot)}</span>
          <span>· {formatCost(snapshot.cost || session?.cost)}</span>
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
          className="gap-1.5"
        >
          <Square className="size-3.5" />
          <span className="hidden sm:inline">Stop</span>
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleInternal}
        aria-pressed={showInternal}
        title={showInternal ? 'Hide internal messages' : 'Show internal messages'}
        className={cn('size-8', showInternal && 'bg-accent')}
      >
        {showInternal ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
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
        className="size-8"
      >
        {allCollapsed ? (
          <ChevronsUpDown className="size-4" />
        ) : (
          <ChevronsDownUp className="size-4" />
        )}
        <span className="sr-only">
          {allCollapsed ? 'Expand all messages' : 'Collapse all messages'}
        </span>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleInfo}
        className={cn('size-8', infoOpen && 'bg-accent')}
      >
        <PanelRight className="size-4" />
        <span className="sr-only">Toggle side panel</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={copyID}>
            <Copy className="size-3.5" /> Copy session ID
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => compact.mutate()}>
            <PanelRight className="size-3.5" /> Compact context
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => archive.mutate(true)}>
            <Archive className="size-3.5" /> Archive session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteSession} className="text-destructive">
            <Trash2 className="size-3.5" /> Delete session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>Give this session a short, searchable title.</DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
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
