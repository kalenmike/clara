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
  maximizeComposer,
  minimizeComposer,
  openComposerWindow,
  pinComposer,
  restoreComposer,
  unpinComposer,
  type ComposerWindow,
} from '@/features/chat/composer-layout'
import {
  composerOpenTarget,
  composerReturnPath,
  isComposerDetached,
  routeComposerTarget,
  type ComposerMode,
  type ComposerTarget,
} from '@/features/chat/composer-session'
import type { PromptFile } from '@/features/chat/use-chat'
import {
  readComposerPinned,
  readComposerSize,
  saveComposerPinned,
  saveComposerSize,
} from '@/lib/storage'

type ComposerHandoff = {
  id: number
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
  pinned: boolean
  target: ComposerTarget | null
  handoff: ComposerHandoff | null
  detached: boolean
  returnPath: string | null
  focusSignal: number
  modelRequest: number
  agentRequest: number
  lastSent: SentSignal | null
  open: (options?: OpenComposerOptions) => void
  close: () => void
  minimize: () => void
  restore: () => void
  togglePin: () => void
  toggleMaximize: () => void
  openModels: () => void
  openAgents: () => void
  focus: () => void
  consumeHandoff: () => void
  reportDraft: (sessionID: string, hasDraft: boolean) => void
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

export function ComposerProvider({ children }: { children: ReactNode }) {
  const route = useComposerRoute()
  const [mode, setMode] = useState<ComposerMode>('closed')
  const [pinned, setPinned] = useState(readComposerPinned)
  const [target, setTarget] = useState<ComposerTarget | null>(route)
  const [handoff, setHandoff] = useState<ComposerHandoff | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  const [modelRequest, setModelRequest] = useState(0)
  const [agentRequest, setAgentRequest] = useState(0)
  const [lastSent, setLastSent] = useState<SentSignal | null>(null)
  const [drafts, setDrafts] = useState<Record<string, boolean>>({})
  const handoffSeq = useRef(0)
  const sentSeq = useRef(0)

  const applyWindow = useCallback((next: ComposerWindow) => {
    setMode(next.mode)
    setPinned(next.pinned)
    saveComposerPinned(next.pinned)
  }, [])

  /**
   * While the composer is closed it belongs to the route. An open or minimized
   * window keeps its target until an explicit compose action re-targets it.
   */
  useEffect(() => {
    if (!route) {
      if (mode !== 'closed') setMode('closed')
      if (target != null) setTarget(null)
      if (handoff != null) setHandoff(null)
      return
    }
    if (mode !== 'closed') return
    if (target?.sessionID === route.sessionID && target.projectID === route.projectID) return
    setTarget(route)
  }, [handoff, mode, route, target])

  const open = useCallback(
    (options: OpenComposerOptions = {}) => {
      const next = composerOpenTarget({
        mode,
        route,
        current: target,
        explicit: options.target,
      })
      if (!next) return

      setTarget(next)
      if (options.text !== undefined || options.files !== undefined) {
        handoffSeq.current += 1
        setHandoff({
          id: handoffSeq.current,
          text: options.text,
          files: options.files,
        })
      } else {
        setHandoff(null)
      }
      applyWindow(openComposerWindow(pinned, readComposerSize()))
      setFocusSignal((value) => value + 1)
      if (options.model) setModelRequest((value) => value + 1)
      if (options.agent) setAgentRequest((value) => value + 1)
    },
    [applyWindow, mode, pinned, route, target]
  )

  const close = useCallback(() => {
    setMode('closed')
    setHandoff(null)
    setTarget(route)
  }, [route])

  const minimize = useCallback(() => {
    applyWindow(minimizeComposer())
  }, [applyWindow])

  const restore = useCallback(() => {
    applyWindow(restoreComposer(readComposerSize()))
    setFocusSignal((value) => value + 1)
  }, [applyWindow])

  const togglePin = useCallback(() => {
    applyWindow(pinned ? unpinComposer(readComposerSize()) : pinComposer({ mode, pinned }))
    setFocusSignal((value) => value + 1)
  }, [applyWindow, mode, pinned])

  const toggleMaximize = useCallback(() => {
    const next = mode === 'maximized' ? restoreComposer('normal') : maximizeComposer()
    saveComposerSize(next.mode === 'maximized' ? 'maximized' : 'normal')
    applyWindow(next)
    setFocusSignal((value) => value + 1)
  }, [applyWindow, mode])

  const openModels = useCallback(() => {
    if (mode === 'closed') {
      open({ model: true })
      return
    }
    if (mode === 'minimized') applyWindow(restoreComposer(readComposerSize()))
    setModelRequest((value) => value + 1)
    setFocusSignal((value) => value + 1)
  }, [applyWindow, mode, open])

  const openAgents = useCallback(() => {
    if (mode === 'closed') {
      open({ agent: true })
      return
    }
    if (mode === 'minimized') applyWindow(restoreComposer(readComposerSize()))
    setAgentRequest((value) => value + 1)
    setFocusSignal((value) => value + 1)
  }, [applyWindow, mode, open])

  const consumeHandoff = useCallback(() => {
    setHandoff(null)
  }, [])

  const focus = useCallback(() => {
    setFocusSignal((value) => value + 1)
  }, [])

  const reportDraft = useCallback((sessionID: string, hasDraft: boolean) => {
    setDrafts((current) =>
      current[sessionID] === hasDraft ? current : { ...current, [sessionID]: hasDraft }
    )
  }, [])

  const draftState = useCallback(
    (sessionID: string | undefined) => (sessionID ? drafts[sessionID] : undefined),
    [drafts]
  )

  const notifySent = useCallback(
    (sessionID: string) => {
      if (route?.sessionID !== sessionID) return
      sentSeq.current += 1
      setLastSent({ sessionID, nonce: sentSeq.current })
    },
    [route?.sessionID]
  )

  const detached = isComposerDetached(target, route?.sessionID)
  const returnPath = composerReturnPath(target)

  const value = useMemo(
    () => ({
      mode,
      pinned,
      target,
      handoff,
      detached,
      returnPath,
      focusSignal,
      modelRequest,
      agentRequest,
      lastSent,
      open,
      close,
      minimize,
      restore,
      togglePin,
      toggleMaximize,
      openModels,
      openAgents,
      focus,
      consumeHandoff,
      reportDraft,
      draftState,
      notifySent,
    }),
    [
      agentRequest,
      close,
      consumeHandoff,
      detached,
      draftState,
      focusSignal,
      handoff,
      lastSent,
      minimize,
      mode,
      modelRequest,
      notifySent,
      open,
      openAgents,
      openModels,
      focus,
      pinned,
      reportDraft,
      restore,
      returnPath,
      target,
      toggleMaximize,
      togglePin,
    ]
  )

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>
}

export function useComposer() {
  const value = useContext(ComposerContext)
  if (!value) throw new Error('useComposer must be used inside ComposerProvider')
  return value
}
