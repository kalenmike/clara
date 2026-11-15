import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '@/components/chat/composer'
import { ComposerTabStrip } from '@/components/chat/composer-tab-strip'
import { useComposer } from '@/features/chat/composer-provider'
import { autoHideComposerMode } from '@/features/chat/composer-layout'
import { composerSessionTitle } from '@/features/chat/composer-session'
import type { ComposerDraft } from '@/features/chat/composer-tabs'
import { useComposerMenuOpen } from '@/features/chat/use-composer-menu-open'
import { useComposerTarget } from '@/features/chat/use-composer-target'
import { useAgents } from '@/features/catalog/use-catalog'
import { primaryAgents } from '@/features/agents/default-agent'
import { useSwitchAgent } from '@/features/chat/use-chat'
import { useComposerAutoHide } from '@/features/settings/use-composer-auto-hide'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useComposerHeight } from '@/hooks/use-composer-height'
import { useElementHeight } from '@/hooks/use-element-height'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'
import { COMPOSER_HEIGHT_MIN, readDraft } from '@/lib/storage'
import { cn } from '@clara/ui/lib/utils'

/** Matches the shell height transition, so the shape fade ends with it. */
const COMPOSER_SHAPE_MS = 150

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
    expanded,
    tabs,
    draftFor,
    handoff,
    focusSignal,
    modelRequest,
    agentRequest,
    currentSessionID,
    selectTab,
    closeTab,
    toggleCollapse,
    toggleExpand,
    openModels,
    openAgents,
    consumeHandoff,
    setDraft,
    notifySent,
  } = useComposer()
  const { height, maxHeight, dragging, handleProps } = useComposerHeight()
  const { enabled: autoHide, pinned, setPinned } = useComposerAutoHide()
  const isTouchDevice = useIsTouchDevice()
  const autoHideEnabled = autoHide && !isTouchDevice
  const [hovered, setHovered] = useState(false)
  const [shapeEntering, setShapeEntering] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const [stripRef, stripHeight] = useElementHeight<HTMLDivElement>()
  const previousShape = useRef(mode)
  const menuOpen = useComposerMenuOpen(sectionRef, autoHideEnabled)
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

  useEffect(() => {
    if (!autoHideEnabled) setHovered(false)
  }, [autoHideEnabled])

  const displayMode = autoHideComposerMode(
    { mode, expanded },
    { enabled: autoHideEnabled, pinned, revealed: hovered, menuOpen }
  )
  const togglePinned = useCallback(() => setPinned(!pinned), [pinned, setPinned])

  /**
   * The dock and the fullscreen panel are different boxes, so the shape change
   * gets a quick fade instead of a height transition. Collapsing stays with the
   * height transition and is left alone here.
   */
  useEffect(() => {
    const previous = previousShape.current
    if (previous === displayMode) return
    previousShape.current = displayMode
    if (previous === 'minimized' || displayMode === 'minimized') return
    setShapeEntering(true)
    const timer = window.setTimeout(() => setShapeEntering(false), COMPOSER_SHAPE_MS)
    return () => window.clearTimeout(timer)
  }, [displayMode])

  const shellHeight =
    displayMode === 'maximized' ? null : displayMode === 'pinned' ? height : stripHeight

  return (
    <section
      ref={sectionRef}
      role="region"
      aria-label={`Composer for ${title}`}
      style={shellHeight ? { height: shellHeight } : undefined}
      className={cn(
        'relative flex flex-col overflow-hidden bg-popover text-popover-foreground',
        displayMode === 'maximized'
          ? 'fixed inset-0 z-50 rounded-none pt-[var(--safe-top)]'
          : 'w-full shrink-0 rounded-none shadow-[0_-12px_24px_-16px_rgba(0,0,0,0.35)]',
        shapeEntering && 'clara-composer-enter',
        displayMode !== 'maximized' &&
          !dragging &&
          'transition-[height] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {displayMode === 'pinned' && (
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

      <div ref={stripRef} className="shrink-0">
        <ComposerTabStrip
          tabs={tabs}
          mode={displayMode}
          autoHide={autoHideEnabled}
          pinned={pinned}
          currentSessionID={currentSessionID}
          selectedSessionID={sessionID}
          selectedPlanReady={planReady}
          onSelect={selectTab}
          onClose={closeTab}
          onToggleExpand={toggleExpand}
          onToggleCollapse={toggleCollapse}
          onTogglePin={togglePinned}
        />
      </div>

      <div
        inert={displayMode === 'minimized'}
        aria-hidden={displayMode === 'minimized'}
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity ease-out motion-reduce:transition-none',
          displayMode === 'minimized'
            ? 'pointer-events-none opacity-0 duration-100'
            : 'opacity-100 duration-150'
        )}
      >
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
