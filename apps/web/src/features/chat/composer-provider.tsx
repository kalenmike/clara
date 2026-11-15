/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMatches } from 'react-router'
import {
  COMPOSER_LAYOUT_DEFAULT,
  expandComposer,
  restoreComposer,
  toggleComposerCollapse,
  type ComposerLayout,
} from '@/features/chat/composer-layout'
import {
  routeComposerTarget,
  type ComposerMode,
  type ComposerTarget,
} from '@/features/chat/composer-session'
import {
  ensureComposerTab,
  hasComposerInput,
  leaveComposerTab,
  parseComposerTabs,
  pruneComposerTabs,
  removeComposerTab,
  serializeComposerTabs,
  type ComposerDraft,
  type ComposerTab,
} from '@/features/chat/composer-tabs'
import type { PromptFile } from '@/features/chat/use-chat'
import { readComposerTabsRaw, readDraft, saveComposerTabsRaw } from '@/lib/storage'

type ComposerHandoff = {
  id: number
  sessionID: string
  text?: string
  files?: PromptFile[]
}

type OpenComposerOptions = {
  target?: ComposerTarget
  text?: string
  files?: PromptFile[]
  model?: boolean
  agent?: boolean
}

type SentSignal = {
  sessionID: string
  nonce: number
}

type ComposerContextValue = {
  mode: ComposerMode
  tabs: ComposerTab[]
  currentSessionID: string | undefined
  selectedSessionID: string | null
  draftFor: (sessionID: string) => ComposerDraft | undefined
  handoff: ComposerHandoff | null
  focusSignal: number
  modelRequest: number
  agentRequest: number
  lastSent: SentSignal | null
  open: (options?: OpenComposerOptions) => void
  selectTab: (sessionID: string) => void
  closeTab: (sessionID: string) => void
  toggleExpand: () => void
  toggleCollapse: () => void
  openModels: () => void
  openAgents: () => void
  consumeHandoff: () => void
  setDraft: (sessionID: string, draft: ComposerDraft) => void
  draftState: (sessionID: string | undefined) => boolean | undefined
  notifySent: (sessionID: string) => void
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

function useComposerRoute() {
  const matches = useMatches()

  return useMemo(() => {
    let projectID: string | undefined
    let sessionID: string | undefined
    for (const match of matches) {
      if (match.params.projectId) projectID = match.params.projectId
      if (match.params.sessionId) sessionID = match.params.sessionId
    }
    return routeComposerTarget(projectID, sessionID)
  }, [matches])
}

function initialComposerTabs(route: ComposerTarget | null): ComposerTab[] {
  const stored = pruneComposerTabs(
    parseComposerTabs(readComposerTabsRaw()),
    route?.sessionID,
    (sessionID) => readDraft(sessionID).trim().length > 0
  )
  return route ? ensureComposerTab(stored, route) : stored
}

export function ComposerProvider({ children }: { children: ReactNode }) {
  const route = useComposerRoute()
  const [layout, setLayout] = useState<ComposerLayout>(COMPOSER_LAYOUT_DEFAULT)
  const [tabs, setTabs] = useState<ComposerTab[]>(() => initialComposerTabs(route))
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(
    route?.sessionID ?? null
  )
  const [draftFlags, setDraftFlags] = useState<Record<string, boolean>>({})
  const [handoff, setHandoff] = useState<ComposerHandoff | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  const [modelRequest, setModelRequest] = useState(0)
  const [agentRequest, setAgentRequest] = useState(0)
  const [lastSent, setLastSent] = useState<SentSignal | null>(null)
  const handoffSeq = useRef(0)
  const sentSeq = useRef(0)
  const draftsRef = useRef<Record<string, ComposerDraft>>({})
  const previousRoute = useRef<ComposerTarget | null>(route)

  /**
   * The route owns the session on screen. Leaving a session keeps its tab only
   * while that session's composer has unsent text or attachments.
   */
  useEffect(() => {
    const previous = previousRoute.current
    previousRoute.current = route

    if (!route) {
      setSelectedSessionID(null)
      return
    }

    setTabs((current) =>
      previous && previous.sessionID !== route.sessionID
        ? leaveComposerTab({
            tabs: current,
            leaving: previous,
            hasInput: hasComposerInput(draftsRef.current[previous.sessionID]),
            next: route,
          })
        : ensureComposerTab(current, route)
    )
    setSelectedSessionID(route.sessionID)
  }, [route])

  useEffect(() => {
    const current = route?.sessionID
    const persisted = tabs.filter(
      (tab) => tab.sessionID === current || hasComposerInput(draftsRef.current[tab.sessionID])
    )
    saveComposerTabsRaw(serializeComposerTabs(persisted))
  }, [draftFlags, route?.sessionID, tabs])

  const open = useCallback(
    (options: OpenComposerOptions = {}) => {
      const target = options.target ?? route
      if (!target) return

      setTabs((current) => ensureComposerTab(current, target))
      setSelectedSessionID(target.sessionID)
      setLayout((current) => restoreComposer(current))
      if (options.text !== undefined || options.files !== undefined) {
        handoffSeq.current += 1
        setHandoff({
          id: handoffSeq.current,
          sessionID: target.sessionID,
          text: options.text,
          files: options.files,
        })
      } else {
        setHandoff(null)
      }
      setFocusSignal((value) => value + 1)
      if (options.model) setModelRequest((value) => value + 1)
      if (options.agent) setAgentRequest((value) => value + 1)
    },
    [route]
  )

  const selectTab = useCallback((sessionID: string) => {
    setSelectedSessionID(sessionID)
    setLayout((current) => restoreComposer(current))
    setFocusSignal((value) => value + 1)
  }, [])

  const closeTab = useCallback(
    (sessionID: string) => {
      if (sessionID === route?.sessionID) return
      setTabs((current) => removeComposerTab(current, sessionID))
      setSelectedSessionID((current) =>
        current === sessionID ? (route?.sessionID ?? null) : current
      )
    },
    [route?.sessionID]
  )

  const toggleExpand = useCallback(() => {
    setLayout((current) => expandComposer(current))
    setFocusSignal((value) => value + 1)
  }, [])

  const toggleCollapse = useCallback(() => {
    setLayout((current) => toggleComposerCollapse(current))
  }, [])

  const openModels = useCallback(() => {
    setLayout((current) => restoreComposer(current))
    setModelRequest((value) => value + 1)
    setFocusSignal((value) => value + 1)
  }, [])

  const openAgents = useCallback(() => {
    setLayout((current) => restoreComposer(current))
    setAgentRequest((value) => value + 1)
    setFocusSignal((value) => value + 1)
  }, [])

  const consumeHandoff = useCallback(() => {
    setHandoff(null)
  }, [])

  const setDraft = useCallback((sessionID: string, draft: ComposerDraft) => {
    const existing = draftsRef.current[sessionID]
    if (existing && existing.text === draft.text && existing.files === draft.files) return
    draftsRef.current = { ...draftsRef.current, [sessionID]: draft }
    const input = hasComposerInput(draft)
    setDraftFlags((current) =>
      current[sessionID] === input ? current : { ...current, [sessionID]: input }
    )
  }, [])

  /** The latest text and attachments for a tab, without re-rendering on typing. */
  const draftFor = useCallback((sessionID: string) => draftsRef.current[sessionID], [])

  const draftState = useCallback(
    (sessionID: string | undefined) => {
      if (!sessionID) return undefined
      return draftFlags[sessionID]
    },
    [draftFlags]
  )

  const notifySent = useCallback(
    (sessionID: string) => {
      if (route?.sessionID !== sessionID) return
      sentSeq.current += 1
      setLastSent({ sessionID, nonce: sentSeq.current })
    },
    [route?.sessionID]
  )

  const value = useMemo(
    () => ({
      mode: layout.mode,
      tabs,
      currentSessionID: route?.sessionID,
      selectedSessionID,
      draftFor,
      handoff,
      focusSignal,
      modelRequest,
      agentRequest,
      lastSent,
      open,
      selectTab,
      closeTab,
      toggleExpand,
      toggleCollapse,
      openModels,
      openAgents,
      consumeHandoff,
      setDraft,
      draftState,
      notifySent,
    }),
    [
      agentRequest,
      closeTab,
      consumeHandoff,
      draftFor,
      draftState,
      focusSignal,
      handoff,
      lastSent,
      layout,
      toggleCollapse,
      modelRequest,
      notifySent,
      open,
      openAgents,
      openModels,
      route?.sessionID,
      selectTab,
      selectedSessionID,
      setDraft,
      tabs,
      toggleExpand,
    ]
  )

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>
}

export function useComposer() {
  const value = useContext(ComposerContext)
  if (!value) throw new Error('useComposer must be used inside ComposerProvider')
  return value
}
