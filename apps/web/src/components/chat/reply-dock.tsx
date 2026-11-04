import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { CornerUpLeft, Maximize2, Minus, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Composer } from '@/components/chat/composer'
import { useComposer } from '@/features/chat/composer-provider'
import {
  composerConnectionLabel,
  composerSessionTitle,
  type ComposerTarget,
} from '@/features/chat/composer-session'
import { useComposerTarget } from '@/features/chat/use-composer-target'
import { useAgents } from '@/features/catalog/use-catalog'
import { useSwitchAgent } from '@/features/chat/use-chat'
import { useSessionPolicy } from '@/features/notifications/session-policy'
import { useSessionWording } from '@/features/sessions/use-wording'
import { cn } from '@/lib/utils'

export function ReplyDock() {
  const { target } = useComposer()
  if (!target) return null
  return <ConnectedComposer target={target} />
}

function ConnectedComposer({ target }: { target: ComposerTarget }) {
  const navigate = useNavigate()
  const {
    mode,
    handoff,
    detached,
    returnPath,
    focusSignal,
    modelRequest,
    agentRequest,
    minimize,
    restore,
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
  const { lowerSingular } = useSessionWording()
  const { isAutomation } = useSessionPolicy()
  const { session, directory, busy, empty, menuMode, disabled } = useComposerTarget(
    target.sessionID
  )
  const agentsQuery = useAgents()
  const switchAgent = useSwitchAgent(target.sessionID)
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.hidden && agent.mode !== 'subagent'),
    [agentsQuery.data]
  )
  const worker = session != null && isAutomation?.(session) === true
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

  if (worker) return null

  return (
    <section
      role="dialog"
      aria-label={`Composer for ${title}`}
      aria-modal={false}
      aria-hidden={mode === 'closed'}
      className={cn(
        'flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
        mode === 'maximized'
          ? 'fixed inset-2 z-50 rounded-xl max-md:inset-x-2 max-md:top-[max(0.5rem,env(safe-area-inset-top))] max-md:bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-3'
          : mode === 'minimized'
            ? 'absolute right-3 bottom-3 z-40 h-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none'
            : 'absolute right-3 bottom-3 z-40 h-[min(34rem,calc(100dvh-5rem))] w-[min(32rem,calc(100vw-1.5rem))] rounded-xl max-md:inset-x-0 max-md:bottom-0 max-md:h-[85%] max-md:w-full max-md:rounded-b-none',
        mode === 'closed' && 'hidden'
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
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
          busy={busy}
          disabled={disabled}
          active={mode !== 'closed'}
          focusSignal={focusSignal}
          modelRequest={modelRequest}
          agentRequest={agentRequest}
          menuMode={menuMode}
          draft={empty}
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
