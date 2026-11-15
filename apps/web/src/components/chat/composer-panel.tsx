import { useCallback, useEffect, useMemo } from 'react'
import { Composer } from '@/components/chat/composer'
import { ComposerTabStrip } from '@/components/chat/composer-tab-strip'
import { useComposer } from '@/features/chat/composer-provider'
import { composerSessionTitle } from '@/features/chat/composer-session'
import type { ComposerDraft } from '@/features/chat/composer-tabs'
import { useComposerTarget } from '@/features/chat/use-composer-target'
import { useAgents } from '@/features/catalog/use-catalog'
import { primaryAgents } from '@/features/agents/default-agent'
import { useSwitchAgent } from '@/features/chat/use-chat'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useComposerHeight } from '@/hooks/use-composer-height'
import { COMPOSER_HEIGHT_MIN, readDraft } from '@/lib/storage'
import { cn } from '@/lib/utils'

export function ComposerPanel({
  harnessID,
  onDone,
}: {
  harnessID?: string
  /** Called after the session on screen is archived or deleted. */
  onDone: () => void
}) {
  const { selectedSessionID } = useComposer()
  if (!selectedSessionID) return null
  return <ConnectedComposer sessionID={selectedSessionID} harnessID={harnessID} onDone={onDone} />
}

function ConnectedComposer({
  sessionID,
  harnessID,
  onDone,
}: {
  sessionID: string
  harnessID?: string
  onDone: () => void
}) {
  const {
    mode,
    tabs,
    draftFor,
    handoff,
    focusSignal,
    modelRequest,
    agentRequest,
    currentSessionID,
    selectTab,
    closeTab,
    minimize,
    toggleExpand,
    openModels,
    openAgents,
    consumeHandoff,
    setDraft,
    notifySent,
  } = useComposer()
  const { height, maxHeight, dragging, handleProps } = useComposerHeight()
  const { lowerSingular } = useSessionWording()
  const { session, directory, busy, ready, empty, menuMode, planReady, disabled } =
    useComposerTarget(sessionID)
  const targetHarnessID = session?.harnessID ?? harnessID
  const agentsQuery = useAgents(targetHarnessID)
  const switchAgent = useSwitchAgent(sessionID)
  const agents = useMemo(() => primaryAgents(agentsQuery.data), [agentsQuery.data])
  const title = composerSessionTitle(session?.title, lowerSingular)
  const initialDraft: ComposerDraft = draftFor(sessionID) ?? {
    text: readDraft(sessionID),
    files: [],
  }
  const startText = handoff?.sessionID === sessionID ? handoff.text : undefined
  const startFiles = handoff?.sessionID === sessionID ? handoff.files : undefined

  useEffect(() => {
    if (handoff) consumeHandoff()
  }, [consumeHandoff, handoff])

  useEffect(() => {
    window.addEventListener('clara:open-models', openModels)
    window.addEventListener('clara:open-agents', openAgents)
    return () => {
      window.removeEventListener('clara:open-models', openModels)
      window.removeEventListener('clara:open-agents', openAgents)
    }
  }, [openAgents, openModels])

  const handleDraftChange = useCallback(
    (draft: ComposerDraft) => setDraft(sessionID, draft),
    [sessionID, setDraft]
  )

  const handleSent = useCallback(() => {
    notifySent(sessionID)
    if (sessionID !== currentSessionID) closeTab(sessionID)
  }, [closeTab, currentSessionID, notifySent, sessionID])

  const handleDone = useCallback(
    (doneSessionID: string) => {
      if (doneSessionID === currentSessionID) onDone()
      else closeTab(doneSessionID)
    },
    [closeTab, currentSessionID, onDone]
  )

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
      role="region"
      aria-label={`Composer for ${title}`}
      style={mode === 'pinned' ? { height } : undefined}
      className={cn(
        'relative flex flex-col overflow-hidden border bg-popover text-popover-foreground',
        mode === 'maximized'
          ? 'fixed inset-0 z-50 rounded-none border-0'
          : 'w-full shrink-0 rounded-none border-x-0 border-b-0 shadow-[0_-12px_24px_-16px_rgba(0,0,0,0.35)]'
      )}
    >
      {mode === 'pinned' && (
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

      <ComposerTabStrip
        tabs={tabs}
        mode={mode}
        currentSessionID={currentSessionID}
        selectedSessionID={sessionID}
        selectedPlanReady={planReady}
        onSelect={selectTab}
        onClose={closeTab}
        onToggleExpand={toggleExpand}
        onMinimize={minimize}
      />

      <div className={cn('flex min-h-0 flex-1 flex-col', mode === 'minimized' && 'hidden')}>
        <Composer
          key={sessionID}
          session={session}
          sessionID={sessionID}
          directory={directory}
          harnessID={targetHarnessID}
          busy={busy}
          ready={ready}
          disabled={disabled}
          focusSignal={focusSignal}
          modelRequest={modelRequest}
          agentRequest={agentRequest}
          menuMode={menuMode}
          draft={empty}
          planReady={planReady}
          initialDraft={initialDraft}
          startText={startText}
          startFiles={startFiles}
          onDraftChange={handleDraftChange}
          onSent={handleSent}
          onDone={handleDone}
          onCycleAgent={cycleAgent}
        />
      </div>
    </section>
  )
}
