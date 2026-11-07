import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import type {
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageInfo,
} from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ChatHeader } from '@/components/chat/chat-header'
import { DraftStartPanel } from '@/components/chat/draft-start-panel'
import { DraftSessionView } from '@/components/chat/draft-session-view'
import { EmptySessionView } from '@/components/chat/empty-session-view'
import { FormPanel } from '@/components/chat/form-panel'
import { MessageList } from '@/components/chat/message-list'
import { PermissionPanel } from '@/components/chat/permission-panel'
import { ReplyActions } from '@/components/chat/reply-actions'
import { ReplyDock } from '@/components/chat/reply-dock'
import { SidePanel } from '@/components/layout/side-panel'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents, useModels } from '@/features/catalog/use-catalog'
import { ComposerProvider, useComposer } from '@/features/chat/composer-provider'
import { findPlanReadyReply } from '@/features/chat/plan-ready'
import { mergeSessionMessages } from '@/features/chat/session-messages'
import { buildTimeline } from '@/features/chat/timeline'
import { estimateStepCost } from '@/features/cost/estimate'
import { useCostDisplay } from '@/features/cost/use-cost-display'
import {
  useChatSnapshot,
  useCompactSession,
  useInterruptSession,
  useSessionInbox,
  useSessionMessages,
  useSwitchAgent,
  useSwitchModel,
} from '@/features/chat/use-chat'
import { useSessionForms } from '@/features/chat/use-forms'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { isModelVisible } from '@/features/models/visibility'
import { useSessionPolicy } from '@/features/notifications/session-policy'
import { useInboxMonitor } from '@/features/sessions/inbox-monitor'
import { canonicalProject, useProjects } from '@/features/projects/use-projects'
import { planMessageFork } from '@/features/sessions/fork'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useForkSession } from '@/features/sessions/use-fork-session'
import { useForwardMessage } from '@/features/sessions/use-forward-message'
import { useMarkSessionViewed } from '@/features/sessions/use-mark-session-viewed'
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
  return (
    <ComposerProvider>
      <ChatPageContent />
    </ComposerProvider>
  )
}

function ChatPageContent() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { status } = useConnection()
  const { isAutomation } = useSessionPolicy()
  const { singular, lowerSingular, lowerPlural } = useSessionWording()
  const inboxMonitor = useInboxMonitor()
  const { setTheme, resolvedTheme } = useTheme()
  const projectsQuery = useProjects()
  const project = projectsQuery.data?.find((item) => item.id === projectId)
  /** The record that owns worktrees, even when the route names a duplicate. */
  const owningProject = canonicalProject(projectsQuery.data ?? [], projectId)
  const sessionQuery = useSession(sessionId ?? null)
  const session = sessionQuery.data
  useMarkSessionViewed(session)
  const worker = session != null && isAutomation?.(session) === true
  const snapshot = useChatSnapshot(sessionId ?? '')
  const messagesQuery = useSessionMessages(sessionId ?? '')
  const inboxQuery = useSessionInbox(sessionId ?? '')
  const formsQuery = useSessionForms(sessionId ?? '')
  const busy = snapshot.status.type !== 'idle'
  const [showInternal, setShowInternal] = useState(readShowInternal)
  const [scrollToEndRequest, setScrollToEndRequest] = useState(0)
  const { mode: composerMode, open: openComposer, draftState, lastSent } = useComposer()
  const storedHasLocalDraft = useMemo(
    () => (sessionId ? readDraft(sessionId).trim().length > 0 : false),
    [sessionId]
  )
  const hasLocalDraft = sessionId
    ? (draftState(sessionId) ?? storedHasLocalDraft)
    : storedHasLocalDraft
  const pendingDrafts = useMemo(
    () => (inboxQuery.data ?? []).filter((item): item is SessionInboxUser => item.type === 'user'),
    [inboxQuery.data]
  )
  const allMessages = useMemo<SessionMessageInfo[]>(
    () =>
      mergeSessionMessages(snapshot.messages, messagesQuery.data?.messages ?? [], pendingDrafts),
    [messagesQuery.data?.messages, pendingDrafts, snapshot.messages]
  )
  const modelsQuery = useModels()
  const { source: costSource } = useCostDisplay()
  const estimateMessageCost = useCallback(
    (step: SessionMessageAssistant) => estimateStepCost(step, modelsQuery.data),
    [modelsQuery.data]
  )
  const timeline = useMemo(
    () =>
      buildTimeline(allMessages, {
        showInternal,
        streaming: busy,
        estimateCost: costSource === 'estimated' ? estimateMessageCost : undefined,
      }),
    [allMessages, busy, costSource, estimateMessageCost, showInternal]
  )
  const timelineMessages = useMemo(
    () => timeline.flatMap((item) => (item.type === 'message' ? [item.message] : [])),
    [timeline]
  )
  const messagesPending =
    (messagesQuery.isPending || inboxQuery.isPending) && allMessages.length === 0
  const messagesReady = snapshot.messages.length > 0 || messagesQuery.isSuccess
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
  const pendingRequestCount = (formsQuery.data?.length ?? 0) + (planReady !== undefined ? 1 : 0)
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
  const { visibility } = useModelVisibility()
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
    (message: SessionMessageInfo, text?: string) => forwardMessage({ message, text }),
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
  const clearComposeState = useCallback(() => {
    navigate(location.pathname, { replace: true })
  }, [location.pathname, navigate])
  const handledCompose = useRef<string | null>(null)
  const autoOpenedSession = useRef<string | null>(null)
  const autoOpenVisit = useRef<string | null>(null)

  useEffect(() => {
    if (!composeState?.compose || !sessionId) return
    if (handledCompose.current === location.key) return
    handledCompose.current = location.key
    openComposer({
      target: { sessionID: sessionId, projectID: projectId },
      text: composeState.draftText,
      files: composeState.draftFiles,
    })
    clearComposeState()
  }, [clearComposeState, composeState, location.key, openComposer, projectId, sessionId])

  useEffect(() => {
    if (!sessionId) return
    if (autoOpenVisit.current !== sessionId) {
      autoOpenVisit.current = sessionId
      autoOpenedSession.current = null
    }
    if (composeState?.compose) return
    if (!isDraftSession || !storedHasLocalDraft) return
    if (autoOpenedSession.current === sessionId) return
    autoOpenedSession.current = sessionId
    if (composerMode !== 'closed') return
    openComposer({ target: { sessionID: sessionId, projectID: projectId } })
  }, [
    composeState?.compose,
    composerMode,
    isDraftSession,
    openComposer,
    projectId,
    sessionId,
    storedHasLocalDraft,
  ])

  const advanceInbox = useCallback(() => {
    if (inboxMonitor.active) inboxMonitor.advance(sessionId)
  }, [inboxMonitor, sessionId])
  const handledSent = useRef(0)

  useEffect(() => {
    if (!lastSent || lastSent.sessionID !== sessionId || lastSent.nonce === handledSent.current) {
      return
    }
    handledSent.current = lastSent.nonce
    advanceInbox()
    setScrollToEndRequest((value) => value + 1)
  }, [advanceInbox, lastSent, sessionId])

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

  const currentModel = (modelsQuery.data ?? [])
    .filter((model) => isModelVisible(model, visibility))
    .find(
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

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {sessionQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading {lowerSingular}…
          </div>
        ) : sessionQuery.isError || !session ? (
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
        ) : (
          <>
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
              <DraftStartPanel key={sessionId} sessionID={sessionId} count={draftCount} />
            )}
            {worker && <FormPanel sessionID={sessionId} />}
            <PermissionPanel sessionID={sessionId} directory={directory} messages={allMessages} />

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

            <ReplyActions
              session={session}
              sessionID={sessionId}
              projectID={projectId}
              busy={busy}
              ready={messagesReady}
              empty={emptySession}
              hasDraft={hasLocalDraft}
              requests={pendingRequestCount}
              worker={worker}
              onDone={() => {
                if (inboxMonitor.active) {
                  inboxMonitor.advance(sessionId)
                  return
                }
                navigate('/')
              }}
            />
          </>
        )}

        <ReplyDock />
      </div>

      {session && infoOpen && isDesktop && (
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

      {session && !isDesktop && (
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
