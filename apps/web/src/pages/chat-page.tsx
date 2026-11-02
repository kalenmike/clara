import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import type { SessionInboxUser, SessionMessageInfo, SessionMessageUser } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ChatHeader } from '@/components/chat/chat-header'
import { DraftStartPanel } from '@/components/chat/draft-start-panel'
import { DraftSessionView } from '@/components/chat/draft-session-view'
import { EmptySessionView } from '@/components/chat/empty-session-view'
import { FormPanel } from '@/components/chat/form-panel'
import { MessageList } from '@/components/chat/message-list'
import { PermissionPanel } from '@/components/chat/permission-panel'
import { PlanReadyPanel } from '@/components/chat/plan-ready-panel'
import { ReplyDock } from '@/components/chat/reply-dock'
import { SidePanel } from '@/components/layout/side-panel'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents, useModels } from '@/features/catalog/use-catalog'
import { CLARA_FEATURE_INCLUDED } from '@/features/clara/flag'
import { composerMenuMode } from '@/features/chat/composer-menu'
import { getVisibleMessages } from '@/features/chat/message-visibility'
import { findPlanReadyReply } from '@/features/chat/plan-ready'
import { buildTimeline } from '@/features/chat/timeline'
import {
  useChatSnapshot,
  useCompactSession,
  useInterruptSession,
  useSessionInbox,
  useSessionMessages,
  useSwitchAgent,
  useSwitchModel,
} from '@/features/chat/use-chat'
import { useInboxMonitor } from '@/features/sessions/inbox-monitor'
import { canonicalProject, useProjects } from '@/features/projects/use-projects'
import { planMessageFork } from '@/features/sessions/fork'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isAutomationSession } from '@/features/sessions/session-automation'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useForkSession } from '@/features/sessions/use-fork-session'
import { useForwardMessage } from '@/features/sessions/use-forward-message'
import { useSession } from '@/features/sessions/use-sessions'
import { useStartSession, type ChatComposeState } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useCollapsedMessages } from '@/hooks/use-collapsed-messages'
import { useKeybinds } from '@/hooks/use-keybinds'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  readDraft,
  readShowInternal,
  readSidePanelTab,
  saveShowInternal,
  saveSidePanelTab,
  type SidePanelTab,
} from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

export function ChatPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { status, relayStatus } = useConnection()
  const claraEnabled = CLARA_FEATURE_INCLUDED && relayStatus?.agent?.management === true
  const { singular, lowerSingular, lowerPlural } = useSessionWording()
  const inboxMonitor = useInboxMonitor()
  const { setTheme, resolvedTheme } = useTheme()
  const projectsQuery = useProjects()
  const project = projectsQuery.data?.find((item) => item.id === projectId)
  /** The record that owns worktrees, even when the route names a duplicate. */
  const owningProject = canonicalProject(projectsQuery.data ?? [], projectId)
  const sessionQuery = useSession(sessionId ?? null)
  const session = sessionQuery.data
  const worker = claraEnabled && session != null && isAutomationSession(session)
  const snapshot = useChatSnapshot(sessionId ?? '')
  const messagesQuery = useSessionMessages(sessionId ?? '')
  const inboxQuery = useSessionInbox(sessionId ?? '')
  const busy = snapshot.status.type !== 'idle'
  const [showInternal, setShowInternal] = useState(readShowInternal)
  const [replyOpen, setReplyOpen] = useState(false)
  const [scrollToEndRequest, setScrollToEndRequest] = useState(0)
  const [draftState, setDraftState] = useState<{
    sessionID: string
    hasDraft: boolean
  } | null>(null)
  const storedHasLocalDraft = useMemo(
    () => (sessionId ? readDraft(sessionId).trim().length > 0 : false),
    [sessionId]
  )
  const hasLocalDraft =
    draftState != null && draftState.sessionID === sessionId
      ? draftState.hasDraft
      : storedHasLocalDraft
  const pendingDrafts = useMemo(
    () => (inboxQuery.data ?? []).filter((item): item is SessionInboxUser => item.type === 'user'),
    [inboxQuery.data]
  )
  const allMessages = useMemo<SessionMessageInfo[]>(() => {
    const base =
      snapshot.messages.length > 0 ? snapshot.messages : (messagesQuery.data?.messages ?? [])
    if (pendingDrafts.length === 0) return base

    const byID = new Map(base.map((message) => [message.id, message]))
    for (const draft of pendingDrafts) {
      if (!byID.has(draft.id)) byID.set(draft.id, inboxDraftToMessage(draft))
    }
    return [...byID.values()].sort((a, b) => a.time.created - b.time.created)
  }, [messagesQuery.data, pendingDrafts, snapshot.messages])
  const visibleMessages = useMemo(
    () => getVisibleMessages(allMessages, showInternal, busy),
    [allMessages, showInternal, busy]
  )
  const timeline = useMemo(
    () => buildTimeline(visibleMessages, { showInternal, streaming: busy }),
    [visibleMessages, showInternal, busy]
  )
  const timelineMessages = useMemo(
    () => timeline.flatMap((item) => (item.type === 'message' ? [item.message] : [])),
    [timeline]
  )
  const messagesPending =
    (messagesQuery.isPending || inboxQuery.isPending) && allMessages.length === 0
  const messagesReady = snapshot.messages.length > 0 || messagesQuery.isSuccess
  const hasAssistant = useMemo(
    () => allMessages.some((message) => message.type === 'assistant'),
    [allMessages]
  )
  const composerMenu = composerMenuMode({ ready: messagesReady, busy, hasAssistant })
  const draftCount = pendingDrafts.length
  const emptySession = useMemo(
    () => !allMessages.some((message) => message.type === 'user' || message.type === 'assistant'),
    [allMessages]
  )
  const isDraftSession =
    messagesReady &&
    emptySession &&
    !busy &&
    session != null &&
    !worker &&
    !isArchivedSession(session) &&
    !isSnoozedSession(session)
  const planReady = useMemo(
    () =>
      session && !worker && !isArchivedSession(session)
        ? findPlanReadyReply(allMessages, session.agent, busy)
        : undefined,
    [allMessages, busy, session, worker]
  )
  const { collapsedIDs, allCollapsed, canToggleAll, toggleMessage, toggleAll } =
    useCollapsedMessages(sessionId ?? '', timelineMessages)
  const [infoOpen, setInfoOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  )
  const [panelTab, setPanelTab] = useState<SidePanelTab>(readSidePanelTab)
  const isDesktop = useMediaQuery('(min-width: 1280px)')

  const agentsQuery = useAgents()
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.hidden && agent.mode !== 'subagent'),
    [agentsQuery.data]
  )
  const switchAgent = useSwitchAgent(sessionId ?? '')
  const switchModel = useSwitchModel(sessionId ?? '')
  const { settings: defaultAgentSettings } = useDefaultAgent()
  const fixedDefaultAgent =
    defaultAgentSettings.mode === 'fixed' &&
    defaultAgentSettings.agent != null &&
    agents.some((agent) => agent.id === defaultAgentSettings.agent)
      ? defaultAgentSettings.agent
      : null
  const draftAgentReset = useRef<string | null>(null)
  const modelsQuery = useModels()
  const compact = useCompactSession(sessionId ?? '')
  const interrupt = useInterruptSession(sessionId ?? '')
  const { mutate: forkSession, isPending: forkPending } = useForkSession({
    session,
    projectID: projectId,
  })
  const { mutate: forwardMessage, isPending: forwardPending } = useForwardMessage({
    session,
    projectID: projectId,
  })
  const serverMessageIDs = useMemo(
    () => new Set(snapshot.messages.map((message) => message.id)),
    [snapshot.messages]
  )
  const canActOnMessage = useCallback(
    (message: SessionMessageInfo) => serverMessageIDs.has(message.id),
    [serverMessageIDs]
  )
  const handleForkSession = useCallback(() => forkSession({}), [forkSession])
  const handleForkMessage = useCallback(
    (message: SessionMessageInfo) => {
      const boundary = planMessageFork(snapshot.messages, message.id)
      if (boundary) forkSession(boundary)
    },
    [forkSession, snapshot.messages]
  )
  const handleForwardMessage = useCallback(
    (message: SessionMessageInfo) => forwardMessage(message),
    [forwardMessage]
  )

  /**
   * A fixed default agent also applies to empty drafts created before the
   * setting changed. Only the first evaluation of an open draft is corrected so
   * a manual switch inside that draft is not immediately undone.
   */
  useEffect(() => {
    if (!fixedDefaultAgent || !isDraftSession || inboxQuery.isPending || draftCount > 0) return
    if (!session || draftAgentReset.current === session.id) return

    draftAgentReset.current = session.id
    if (session.agent !== fixedDefaultAgent) switchAgent.mutate(fixedDefaultAgent)
  }, [draftCount, fixedDefaultAgent, inboxQuery.isPending, isDraftSession, session, switchAgent])

  const directory = session?.location.directory ?? project?.canonical
  const { startSession } = useStartSession({
    projectID: projectId,
    directory,
    agent: session?.agent,
    model: session?.model,
  })
  const composeState = location.state as ChatComposeState | null
  const startExpanded = Boolean(composeState?.compose)
  const startText = composeState?.draftText
  const startFiles = composeState?.draftFiles
  const clearComposeState = useCallback(() => {
    navigate(location.pathname, { replace: true })
  }, [location.pathname, navigate])
  const handleReplyOpenChange = useCallback((open: boolean) => setReplyOpen(open), [])
  const handleDraftChange = useCallback(
    (hasDraft: boolean) => {
      if (sessionId) setDraftState({ sessionID: sessionId, hasDraft })
    },
    [sessionId]
  )
  const adjustFromPlan = useCallback(() => {
    setReplyOpen(true)
    window.dispatchEvent(new Event('clara:open-reply'))
  }, [])
  const advanceInbox = useCallback(() => {
    if (inboxMonitor.active) inboxMonitor.advance(sessionId)
  }, [inboxMonitor, sessionId])
  const handleSent = useCallback(() => {
    advanceInbox()
    setScrollToEndRequest((value) => value + 1)
  }, [advanceInbox])

  useEffect(() => {
    saveShowInternal(showInternal)
  }, [showInternal])

  useEffect(() => {
    saveSidePanelTab(panelTab)
  }, [panelTab])

  const toggleInternal = useCallback(() => {
    setShowInternal((value) => !value)
  }, [])

  const togglePanel = useCallback(() => {
    if (infoOpen) {
      setInfoOpen(false)
      return
    }
    setPanelTab('info')
    setInfoOpen(true)
  }, [infoOpen])

  const openGitPanel = useCallback(() => {
    setPanelTab('git')
    setInfoOpen(true)
  }, [])

  const toggleTerminal = useCallback(() => {
    if (infoOpen && panelTab === 'terminal') {
      setInfoOpen(false)
      return
    }
    setPanelTab('terminal')
    setInfoOpen(true)
  }, [infoOpen, panelTab])

  const currentModel = modelsQuery.data?.find(
    (model) =>
      model.modelID === session?.model?.id && model.providerID === session?.model?.providerID
  )

  useEffect(() => {
    const cycle = () => {
      if (!currentModel || currentModel.variants.length < 2) return
      const current = session?.model?.variant ?? 'default'
      const index = currentModel.variants.findIndex((variant) => variant.id === current)
      const next = currentModel.variants[(index + 1) % currentModel.variants.length]
      switchModel.mutate({
        id: currentModel.modelID,
        providerID: currentModel.providerID,
        variant: next.id === 'default' ? undefined : next.id,
      })
    }
    window.addEventListener('clara:cycle-variant', cycle)
    return () => window.removeEventListener('clara:cycle-variant', cycle)
  }, [currentModel, session?.model?.variant, switchModel])

  const copyLastReply = useCallback(() => {
    const last = [...snapshot.messages].reverse().find((message) => message.type === 'assistant')
    if (!last || last.type !== 'assistant') return
    const text = last.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (!text) return
    void navigator.clipboard.writeText(text)
    toast.success('Copied last reply')
  }, [snapshot.messages])

  const cycleAgent = useCallback(
    (direction: 1 | -1) => {
      if (agents.length === 0) return
      const index = agents.findIndex((agent) => agent.id === session?.agent)
      const next = agents[(index + direction + agents.length) % agents.length]
      if (next) switchAgent.mutate(next.id)
    },
    [agents, session?.agent, switchAgent]
  )

  useKeybinds({
    onNewSession: startSession,
    onSessions: () => {
      if (project) navigate(`/p/${project.id}`)
    },
    onToggleInfo: togglePanel,
    onOpenGit: openGitPanel,
    onToggleTerminal: toggleTerminal,
    onCompact: () => {
      if (sessionId && !busy) compact.mutate()
    },
    onCopyReply: copyLastReply,
    onToggleMessages: toggleAll,
    onInterrupt: () => {
      if (busy) interrupt.mutate()
    },
    onOpenModels: () => window.dispatchEvent(new Event('clara:open-models')),
    onOpenAgents: () => window.dispatchEvent(new Event('clara:open-agents')),
    onCycleAgent: cycleAgent,
    onCycleVariant: () => window.dispatchEvent(new Event('clara:cycle-variant')),
    onToggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
  })

  if (status !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Connecting…
      </div>
    )
  }

  if (!sessionId) {
    return <Navigate to={projectId ? `/p/${projectId}` : '/'} replace />
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading {lowerSingular}…
      </div>
    )
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium">{singular} not found</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have been deleted or the server is unreachable.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={projectId ? `/p/${projectId}` : '/'}>
            <ArrowLeft className="size-4" /> Back to {lowerPlural}
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChatHeader
          session={session}
          snapshot={snapshot}
          infoOpen={infoOpen}
          onToggleInfo={togglePanel}
          onFork={handleForkSession}
          forkPending={forkPending}
          onDeleted={() => navigate(`/p/${projectId ?? session.projectID}`)}
          allCollapsed={allCollapsed}
          canToggleAll={canToggleAll}
          onToggleAll={toggleAll}
          showInternal={showInternal}
          onToggleInternal={toggleInternal}
          worker={worker}
        />

        {draftCount > 0 && !busy && !worker && !isArchivedSession(session) && (
          <DraftStartPanel sessionID={sessionId} count={draftCount} />
        )}
        <FormPanel sessionID={sessionId} />
        <PermissionPanel sessionID={sessionId} directory={directory} messages={allMessages} />
        {planReady && !replyOpen && (
          <PlanReadyPanel
            key={planReady.id}
            sessionID={sessionId}
            onAdjustPlan={adjustFromPlan}
            onStartWork={advanceInbox}
          />
        )}

        {messagesPending ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading conversation…
          </div>
        ) : messagesQuery.isError && allMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium">Could not load the conversation</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              The server did not return this {lowerSingular}&apos;s messages.
            </p>
            <Button variant="outline" size="sm" onClick={() => void messagesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : timeline.length === 0 ? (
          isDraftSession ? (
            <DraftSessionView hasDraft={hasLocalDraft} />
          ) : (
            <EmptySessionView
              title="No messages"
              description={`This ${lowerSingular} has no messages yet.`}
            />
          )
        ) : (
          <MessageList
            sessionID={sessionId}
            items={timeline}
            scrollToEndRequest={scrollToEndRequest}
            streaming={busy}
            showInternal={showInternal}
            revision={snapshot.revision}
            historyRevision={snapshot.historyRevision}
            collapsedIDs={collapsedIDs}
            hasOlder={snapshot.hasOlder}
            loadingOlder={messagesQuery.loadingOlder}
            onLoadOlder={() => void messagesQuery.loadOlder()}
            onToggleMessage={toggleMessage}
            onForkMessage={handleForkMessage}
            onForwardMessage={handleForwardMessage}
            canActOnMessage={canActOnMessage}
            canFork={!worker}
            actionsDisabled={forkPending || forwardPending}
          />
        )}

        <ReplyDock
          key={sessionId}
          session={session}
          sessionID={sessionId}
          directory={directory}
          busy={busy}
          disabled={sessionQuery.isError}
          empty={emptySession}
          ready={messagesReady}
          menuMode={composerMenu}
          hasDraft={hasLocalDraft}
          autoOpen={isDraftSession && storedHasLocalDraft}
          startExpanded={startExpanded}
          startText={startText}
          startFiles={startFiles}
          onStartExpandedConsumed={clearComposeState}
          onDraftChange={handleDraftChange}
          onOpenChange={handleReplyOpenChange}
          onDone={() => {
            if (inboxMonitor.active) {
              inboxMonitor.advance(sessionId)
              return
            }
            navigate('/')
          }}
          onSent={handleSent}
          onCycleAgent={cycleAgent}
          worker={worker}
        />
      </div>

      {infoOpen && isDesktop && (
        <SidePanel
          session={session}
          snapshot={snapshot}
          messages={allMessages}
          directory={directory}
          projectID={owningProject?.id ?? projectId}
          canonical={owningProject?.canonical ?? project?.canonical}
          draft={isDraftSession}
          tab={panelTab}
          onTabChange={setPanelTab}
        />
      )}

      {!isDesktop && (
        <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
          <SheetContent
            side="right"
            className="p-0 data-[side=right]:w-full sm:max-w-none"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">{singular} panel</SheetTitle>
            <SheetDescription className="sr-only">
              Usage, plan, cost, git changes, and the pair terminal
            </SheetDescription>
            <SidePanel
              session={session}
              snapshot={snapshot}
              messages={allMessages}
              directory={directory}
              projectID={owningProject?.id ?? projectId}
              canonical={owningProject?.canonical ?? project?.canonical}
              draft={isDraftSession}
              tab={panelTab}
              onTabChange={setPanelTab}
              onClose={() => setInfoOpen(false)}
              resizable={false}
              className="w-full"
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function inboxDraftToMessage(item: SessionInboxUser): SessionMessageUser {
  return {
    id: item.id,
    metadata: item.payload.metadata,
    time: item.time,
    text: item.payload.text,
    files: item.payload.files,
    agents: item.payload.agents,
    skills: item.payload.skills,
    type: 'user',
  }
}
