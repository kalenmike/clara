import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  Loader2,
  Maximize2,
  Minus,
  Minimize2,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Composer } from '@/components/chat/composer'
import { DoneButton } from '@/components/chat/done-button'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useDoneSession } from '@/features/sessions/use-session-archive'
import { useReopenSession } from '@/features/sessions/use-sessions'
import { useSessionWording } from '@/features/sessions/use-wording'
import { readComposerSize, saveComposerSize, saveDraft } from '@/lib/storage'
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
  hasDraft,
  autoOpen,
  startExpanded,
  onStartExpandedConsumed,
  onDraftChange,
  onOpenChange,
  onDone,
  onSent,
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
  hasDraft: boolean
  autoOpen?: boolean
  startExpanded?: boolean
  onStartExpandedConsumed?: () => void
  onDraftChange: (hasDraft: boolean) => void
  onOpenChange?: (open: boolean) => void
  onDone: () => void
  onSent?: () => void
  onCycleAgent: (direction: 1 | -1) => void
}) {
  const [mode, setMode] = useState<WindowMode>(() =>
    startExpanded ? readComposerSize() : 'closed'
  )
  const [focusSignal, setFocusSignal] = useState(startExpanded ? 1 : 0)
  const [modelRequest, setModelRequest] = useState(0)
  const [agentRequest, setAgentRequest] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const redirectTimer = useRef<number | undefined>(undefined)
  const autoOpened = useRef(Boolean(startExpanded))
  const done = useDoneSession()
  const reopenSession = useReopenSession()
  const { singular, lowerSingular } = useSessionWording()
  const archived = session != null && isArchivedSession(session)
  const snoozed = session != null && isSnoozedSession(session)
  const canFinish = session != null && ready && !busy && !archived && !snoozed
  const canArchive = canFinish && !empty
  const canDeleteEmpty = canFinish && empty
  const canNew = canFinish && empty
  const canReopen = session != null && ready && !busy && (archived || snoozed)
  const panelLabel = empty ? 'New message' : 'Reply'

  const handleSent = useCallback(() => {
    setMode('closed')
    window.setTimeout(() => triggerRef.current?.focus(), 0)
    onSent?.()
  }, [onSent])

  useEffect(() => {
    if (startExpanded) onStartExpandedConsumed?.()
  }, [startExpanded, onStartExpandedConsumed])

  useEffect(() => {
    if (!autoOpen || autoOpened.current) return
    autoOpened.current = true
    setMode((current) =>
      current === 'closed' || current === 'minimized' ? readComposerSize() : current
    )
    setFocusSignal((value) => value + 1)
  }, [autoOpen])

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
    window.addEventListener('clara:open-reply', openReply)
    return () => {
      window.removeEventListener('clara:open-reply', openReply)
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

  const archiveSession = () => {
    if (!session) return
    const pathAtClick = window.location.pathname
    setLeaving(true)
    done.mutate(
      { session, empty: false },
      {
        onSuccess: () => {
          toast.success(`${singular} complete`, { description: 'Nice work. On to the next one.' })
          if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
          redirectTimer.current = window.setTimeout(() => {
            if (window.location.pathname === pathAtClick) onDone()
          }, DONE_REDIRECT_DELAY_MS)
        },
        onError: () => {
          setLeaving(false)
          toast.error(`Could not mark the ${lowerSingular} done`)
        },
      }
    )
  }

  const deleteEmpty = () => {
    if (!session || done.isPending) return
    done.mutate(
      { session, empty: true },
      {
        onSuccess: () => {
          saveDraft(sessionID, '')
          toast.success('Empty draft deleted')
          onDone()
        },
        onError: () => toast.error('Could not delete the empty draft'),
      }
    )
  }

  const reopen = () => {
    if (!session) return
    reopenSession.mutate(
      { session },
      {
        onSuccess: () => toast.success(`${singular} reopened`),
        onError: () => toast.error(`Could not reopen the ${lowerSingular}`),
      }
    )
  }

  return (
    <>
      {mode === 'closed' && (canFinish || canReopen || !empty || leaving) && (
        <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2 max-md:right-5 max-md:bottom-6">
          {(canArchive || leaving) && (
            <DoneButton pending={done.isPending || leaving} onConfirm={archiveSession} />
          )}

          {canReopen && !leaving && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={reopen}
              disabled={reopenSession.isPending}
              title={`Reopen ${lowerSingular}`}
              className="gap-2 rounded-full bg-background shadow-lg max-md:h-11"
            >
              {reopenSession.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArchiveRestore className="size-4" />
              )}
              Reopen
            </Button>
          )}

          {canDeleteEmpty && !leaving && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={deleteEmpty}
              disabled={done.isPending}
              title="Delete empty draft"
              className="gap-2 rounded-full bg-background text-destructive shadow-lg hover:text-destructive max-md:h-11"
            >
              {done.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
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
              className="relative gap-2 rounded-full px-4 shadow-lg max-md:h-11"
            >
              <SquarePen className="size-4" />
              Reply
              {hasDraft && (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-primary" />
              )}
            </Button>
          )}

          {canNew && (
            <Button
              ref={triggerRef}
              type="button"
              size="lg"
              onClick={openPanel}
              aria-haspopup="dialog"
              aria-expanded={false}
              title={hasDraft ? 'New message (draft saved)' : 'New message'}
              className="relative gap-2 rounded-full px-4 shadow-lg max-md:h-11"
            >
              <SquarePen className="size-4" />
              New
              {hasDraft && (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-primary" />
              )}
            </Button>
          )}
        </div>
      )}

      <section
        role="dialog"
        aria-label={panelLabel}
        aria-modal={false}
        aria-hidden={mode === 'closed'}
        className={cn(
          'flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
          mode === 'maximized'
            ? 'fixed inset-2 z-50 rounded-xl max-md:inset-x-2 max-md:top-2 max-md:bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-3'
            : mode === 'minimized'
              ? 'absolute right-3 bottom-3 z-40 h-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none'
              : 'absolute right-3 bottom-3 z-40 h-[min(34rem,calc(100dvh-5rem))] w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[85%] max-md:w-full max-md:rounded-b-none',
          mode === 'closed' && 'hidden'
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{panelLabel}</div>
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
                className="max-md:size-11"
                onClick={toggleMinimize}
                aria-label={mode === 'minimized' ? 'Restore reply window' : 'Minimize reply window'}
              >
                <Minus className="size-3.5 max-md:size-5" />
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
                className="max-md:size-11"
                onClick={toggleMaximize}
                aria-label={mode === 'maximized' ? 'Restore reply window' : 'Maximize reply window'}
              >
                {mode === 'maximized' ? (
                  <Minimize2 className="size-3.5 max-md:size-5" />
                ) : (
                  <Maximize2 className="size-3.5 max-md:size-5" />
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
                className="max-md:size-11"
                onClick={closePanel}
                aria-label="Close reply window"
              >
                <X className="size-3.5 max-md:size-5" />
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
            draft={empty}
            onDraftChange={onDraftChange}
            onSent={handleSent}
            onCycleAgent={onCycleAgent}
          />
        </div>
      </section>
    </>
  )
}
