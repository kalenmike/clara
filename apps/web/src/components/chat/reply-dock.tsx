import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { CornerUpLeft, Maximize2, Minus, Minimize2, Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Composer } from '@/components/chat/composer'
import { composerDocked } from '@/features/chat/composer-layout'
import { useComposer } from '@/features/chat/composer-provider'
import { composerRequestCount } from '@/features/chat/composer-requests'
import {
  composerConnectionLabel,
  composerSessionTitle,
  type ComposerTarget,
} from '@/features/chat/composer-session'
import { useComposerTarget } from '@/features/chat/use-composer-target'
import { useSessionForms } from '@/features/chat/use-forms'
import { useAgents } from '@/features/catalog/use-catalog'
import { useSwitchAgent } from '@/features/chat/use-chat'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useComposerHeight } from '@/hooks/use-composer-height'
import { COMPOSER_HEIGHT_MIN } from '@/lib/storage'
import { cn } from '@/lib/utils'

export function ReplyDock({ harnessID }: { harnessID?: string }) {
  const { target } = useComposer()
  if (!target) return null
  return <ConnectedComposer target={target} harnessID={harnessID} />
}

function ConnectedComposer({ target, harnessID }: { target: ComposerTarget; harnessID?: string }) {
  const navigate = useNavigate()
  const {
    mode,
    pinned,
    handoff,
    detached,
    returnPath,
    focusSignal,
    modelRequest,
    agentRequest,
    minimize,
    restore,
    togglePin,
    toggleMaximize,
    close,
    open,
    openModels,
    openAgents,
    focus,
    consumeHandoff,
    reportDraft,
    notifySent,
  } = useComposer()
  const { height, maxHeight, dragging, handleProps } = useComposerHeight()
  const docked = composerDocked({ mode, pinned })
  const { lowerSingular } = useSessionWording()
  const { session, directory, busy, empty, menuMode, planReady, disabled } = useComposerTarget(
    target.sessionID
  )
  const formsQuery = useSessionForms(target.sessionID)
  const requestCount = composerRequestCount(formsQuery.data ?? [], planReady)
  const targetHarnessID = session?.harnessID ?? harnessID
  const agentsQuery = useAgents(targetHarnessID)
  const switchAgent = useSwitchAgent(target.sessionID)
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.hidden && agent.mode !== 'subagent'),
    [agentsQuery.data]
  )
  const title = composerSessionTitle(session?.title, lowerSingular)
  const connectionLabel = composerConnectionLabel(detached, lowerSingular)

  useEffect(() => {
    if (handoff) consumeHandoff()
  }, [consumeHandoff, handoff])

  useEffect(() => {
    const openReply = () => {
      if (mode === 'closed') open()
      else if (mode === 'minimized') restore()
      else focus()
    }
    const openModelPicker = () => openModels()
    const openAgentPicker = () => openAgents()

    window.addEventListener('clara:open-reply', openReply)
    window.addEventListener('clara:open-models', openModelPicker)
    window.addEventListener('clara:open-agents', openAgentPicker)
    return () => {
      window.removeEventListener('clara:open-reply', openReply)
      window.removeEventListener('clara:open-models', openModelPicker)
      window.removeEventListener('clara:open-agents', openAgentPicker)
    }
  }, [focus, mode, open, openAgents, openModels, restore])

  const handleDraftChange = useCallback(
    (hasDraft: boolean) => {
      reportDraft(target.sessionID, hasDraft)
    },
    [reportDraft, target.sessionID]
  )

  const handleSent = useCallback(() => {
    notifySent(target.sessionID)
    close()
  }, [close, notifySent, target.sessionID])

  const cycleAgent = useCallback(
    (direction: 1 | -1) => {
      if (agents.length === 0) return
      const index = agents.findIndex((agent) => agent.id === session?.agent)
      const next = agents[(index + direction + agents.length) % agents.length]
      if (next) switchAgent.mutate(next.id)
    },
    [agents, session?.agent, switchAgent]
  )

  return (
    <section
      role="dialog"
      aria-label={`Composer for ${title}`}
      aria-modal={false}
      aria-hidden={mode === 'closed'}
      style={docked ? { height } : undefined}
      className={cn(
        'relative flex flex-col overflow-hidden border bg-popover text-popover-foreground',
        docked
          ? 'w-full shrink-0 rounded-none border-x-0 border-b-0 shadow-[0_-12px_24px_-16px_rgba(0,0,0,0.35)]'
          : 'shadow-2xl',
        mode === 'maximized'
          ? 'fixed inset-2 z-50 rounded-xl max-md:inset-x-2 max-md:top-[max(0.5rem,env(safe-area-inset-top))] max-md:bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-3'
          : docked
            ? ''
            : mode === 'minimized'
              ? 'absolute right-3 bottom-3 z-40 h-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none'
              : 'absolute right-3 bottom-3 z-40 h-[min(34rem,calc(100dvh-5rem))] w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[85%] max-md:w-full max-md:rounded-b-none',
        mode === 'closed' && 'hidden'
      )}
    >
      {docked && (
        <div
          {...handleProps}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize composer"
          aria-valuenow={height}
          aria-valuemin={COMPOSER_HEIGHT_MIN}
          aria-valuemax={maxHeight}
          tabIndex={0}
          className="group absolute inset-x-0 top-0 z-20 h-2 cursor-row-resize touch-none outline-none focus-visible:bg-primary/10 max-md:h-3"
        >
          <div
            className={cn(
              'absolute inset-x-0 top-0 h-px transition-colors',
              dragging
                ? 'bg-primary'
                : 'bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary'
            )}
          />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-medium">{title}</div>
            {requestCount > 0 && (
              <span
                className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-semibold text-white"
                title={
                  requestCount === 1 ? '1 request waiting' : `${requestCount} requests waiting`
                }
              >
                {requestCount > 9 ? '9+' : requestCount}
              </span>
            )}
          </div>
          <div
            className={cn(
              'truncate text-[10px]',
              detached ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
            )}
          >
            {connectionLabel}
          </div>
        </div>

        {detached && returnPath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="max-md:size-11"
                onClick={() => navigate(returnPath)}
                aria-label={`Return to ${title}`}
                title={`Return to ${title}`}
              >
                <CornerUpLeft className="size-3.5 max-md:size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Return to {title}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('max-md:size-11', pinned && 'bg-accent text-accent-foreground')}
              onClick={togglePin}
              aria-label={pinned ? 'Unpin composer' : 'Pin composer'}
              aria-pressed={pinned}
            >
              <Pin className="size-3.5 max-md:size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{pinned ? 'Unpin from the bottom' : 'Pin to the bottom'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-md:size-11"
              onClick={mode === 'minimized' ? restore : minimize}
              aria-label={mode === 'minimized' ? 'Restore composer' : 'Minimize composer'}
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
              aria-label={mode === 'maximized' ? 'Restore composer' : 'Maximize composer'}
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
              onClick={close}
              aria-label="Close composer"
            >
              <X className="size-3.5 max-md:size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col', mode === 'minimized' && 'hidden')}>
        <Composer
          key={target.sessionID}
          session={session}
          sessionID={target.sessionID}
          directory={directory}
          harnessID={targetHarnessID}
          busy={busy}
          disabled={disabled}
          active={mode !== 'closed'}
          focusSignal={focusSignal}
          modelRequest={modelRequest}
          agentRequest={agentRequest}
          menuMode={menuMode}
          draft={empty}
          planReady={planReady}
          startText={handoff?.text}
          startFiles={handoff?.files}
          onDraftChange={handleDraftChange}
          onSent={handleSent}
          onCycleAgent={cycleAgent}
        />
      </div>
    </section>
  )
}
