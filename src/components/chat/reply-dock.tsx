import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchiveRestore, Loader2, Maximize2, Minus, Minimize2, SquarePen, X } from 'lucide-react'
import { toast } from 'sonner'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Composer } from '@/components/chat/composer'
import { DoneButton } from '@/components/chat/done-button'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { useDoneSession } from '@/features/sessions/use-session-archive'
import { useArchiveSession } from '@/features/sessions/use-sessions'
import { readComposerSize, saveComposerSize } from '@/lib/storage'
import { cn } from '@/lib/utils'

type WindowMode = 'closed' | 'normal' | 'minimized' | 'maximized'

/** Keep the Done celebration on screen for a beat before returning home. */
const DONE_REDIRECT_DELAY_MS = 600

export function ReplyDock({
  session,
  sessionID,
  directory,
  busy,
  disabled,
  empty,
  ready,
  canSaveAsDraft,
  startExpanded,
  onStartExpandedConsumed,
  onOpenChange,
  onDone,
  onCycleAgent,
}: {
  session: SessionInfo | undefined
  sessionID: string
  directory: string | undefined
  busy: boolean
  disabled?: boolean
  empty: boolean
  ready: boolean
  canSaveAsDraft: boolean
  startExpanded?: boolean
  onStartExpandedConsumed?: () => void
  onOpenChange?: (open: boolean) => void
  onDone: () => void
  onCycleAgent: (direction: 1 | -1) => void
}) {
  const [mode, setMode] = useState<WindowMode>(() =>
    startExpanded ? readComposerSize() : 'closed'
  )
  const [hasDraft, setHasDraft] = useState(false)
  const [focusSignal, setFocusSignal] = useState(startExpanded ? 1 : 0)
  const [modelRequest, setModelRequest] = useState(0)
  const [agentRequest, setAgentRequest] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const redirectTimer = useRef<number | undefined>(undefined)
  const done = useDoneSession()
  const archive = useArchiveSession(session?.id ?? '')
  const archived = session != null && isArchivedSession(session)
  const canDone = session != null && ready && !busy && !archived
  const canReopen = session != null && ready && !busy && archived

  const handleDraftChange = useCallback((value: boolean) => setHasDraft(value), [])

  const handleSent = useCallback(() => {
    setMode('closed')
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (startExpanded) onStartExpandedConsumed?.()
  }, [startExpanded, onStartExpandedConsumed])

  useEffect(() => {
    onOpenChange?.(mode !== 'closed')
  }, [mode, onOpenChange])

  useEffect(() => {
    const openModels = () => {
      setMode((current) =>
        current === 'closed' || current === 'minimized' ? readComposerSize() : current
      )
      setModelRequest((value) => value + 1)
      setFocusSignal((value) => value + 1)
    }
    const openAgents = () => {
      setMode((current) =>
        current === 'closed' || current === 'minimized' ? readComposerSize() : current
      )
      setAgentRequest((value) => value + 1)
      setFocusSignal((value) => value + 1)
    }
    window.addEventListener('clara:open-models', openModels)
    window.addEventListener('clara:open-agents', openAgents)
    return () => {
      window.removeEventListener('clara:open-models', openModels)
      window.removeEventListener('clara:open-agents', openAgents)
    }
  }, [])

  useEffect(() => {
    const openReply = () => {
      setMode((current) =>
        current === 'closed' || current === 'minimized' ? readComposerSize() : current
      )
      setFocusSignal((value) => value + 1)
    }
    const expandReply = () => {
      setMode(readComposerSize())
      setFocusSignal((value) => value + 1)
    }
    window.addEventListener('clara:open-reply', openReply)
    window.addEventListener('clara:expand-reply', expandReply)
    return () => {
      window.removeEventListener('clara:open-reply', openReply)
      window.removeEventListener('clara:expand-reply', expandReply)
    }
  }, [])

  const openPanel = () => {
    if (mode === 'closed' || mode === 'minimized') setMode(readComposerSize())
    setFocusSignal((value) => value + 1)
  }

  const toggleMinimize = () => {
    if (mode === 'minimized') {
      setMode(readComposerSize())
      setFocusSignal((value) => value + 1)
      return
    }
    setMode('minimized')
  }

  const toggleMaximize = () => {
    const next = mode === 'maximized' ? 'normal' : 'maximized'
    saveComposerSize(next)
    setMode(next)
    setFocusSignal((value) => value + 1)
  }

  const closePanel = () => {
    setMode('closed')
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  const markDone = () => {
    if (!session) return
    const pathAtClick = window.location.pathname
    setLeaving(true)
    done.mutate(
      { session, empty },
      {
        onSuccess: () => {
          if (empty) toast.success('Empty session deleted')
          else toast.success('Session complete', { description: 'Nice work. On to the next one.' })
          if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
          redirectTimer.current = window.setTimeout(() => {
            if (window.location.pathname === pathAtClick) onDone()
          }, DONE_REDIRECT_DELAY_MS)
        },
        onError: () => {
          setLeaving(false)
          toast.error(
            empty ? 'Could not delete the empty session' : 'Could not mark the session done'
          )
        },
      }
    )
  }

  const reopen = () => {
    if (!session) return
    archive.mutate(false, {
      onSuccess: () => toast.success('Session reopened'),
      onError: () => toast.error('Could not reopen the session'),
    })
  }

  return (
    <>
      {mode === 'closed' && (canDone || canReopen || !empty || leaving) && (
        <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2">
          {(canDone || leaving) && (
            <DoneButton empty={empty} pending={done.isPending || leaving} onConfirm={markDone} />
          )}

          {canReopen && !leaving && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={reopen}
              disabled={archive.isPending}
              title="Reopen session"
              className="gap-2 rounded-full bg-background shadow-lg"
            >
              {archive.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArchiveRestore className="size-4" />
              )}
              Reopen
            </Button>
          )}

          {!empty && (
            <Button
              ref={triggerRef}
              type="button"
              size="lg"
              onClick={openPanel}
              aria-haspopup="dialog"
              aria-expanded={false}
              title={hasDraft ? 'Reply (draft saved)' : 'Reply'}
              className="relative gap-2 rounded-full px-4 shadow-lg"
            >
              <SquarePen className="size-4" />
              Reply
              {hasDraft && (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-primary" />
              )}
            </Button>
          )}
        </div>
      )}

      <section
        role="dialog"
        aria-label="Reply"
        aria-modal={false}
        aria-hidden={mode === 'closed'}
        className={cn(
          'flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
          mode === 'maximized'
            ? 'fixed inset-2 z-50 rounded-xl sm:inset-3'
            : mode === 'minimized'
              ? 'absolute right-3 bottom-3 z-40 h-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none'
              : 'absolute right-3 bottom-3 z-40 h-[min(34rem,calc(100dvh-5rem))] w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[85%] max-md:w-full max-md:rounded-b-none',
          mode === 'closed' && 'hidden'
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Reply</div>
            {session?.title && (
              <div className="truncate text-[10px] text-muted-foreground">{session.title}</div>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleMinimize}
                aria-label={mode === 'minimized' ? 'Restore reply window' : 'Minimize reply window'}
              >
                <Minus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{mode === 'minimized' ? 'Restore' : 'Minimize'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleMaximize}
                aria-label={mode === 'maximized' ? 'Restore reply window' : 'Maximize reply window'}
              >
                {mode === 'maximized' ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{mode === 'maximized' ? 'Restore' : 'Maximize'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closePanel}
                aria-label="Close reply window"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>

        <div className={cn('flex min-h-0 flex-1 flex-col', mode === 'minimized' && 'hidden')}>
          <Composer
            session={session}
            sessionID={sessionID}
            directory={directory}
            busy={busy}
            disabled={disabled}
            active={mode !== 'closed'}
            focusSignal={focusSignal}
            modelRequest={modelRequest}
            agentRequest={agentRequest}
            canSaveAsDraft={canSaveAsDraft}
            onDraftChange={handleDraftChange}
            onSent={handleSent}
            onCycleAgent={onCycleAgent}
          />
        </div>
      </section>
    </>
  )
}
