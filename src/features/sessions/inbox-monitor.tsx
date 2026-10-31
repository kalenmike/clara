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
import { useLocation, useMatches, useNavigate } from 'react-router'
import { canonicalProject, canonicalProjects, useProjects } from '@/features/projects/use-projects'
import { useInboxSessions } from '@/features/sessions/use-inbox-sessions'
import { useSessionWording } from '@/features/sessions/use-wording'
import { readInboxMonitor, readLastProject, saveInboxMonitor } from '@/lib/storage'

type InboxMonitorContextValue = {
  active: boolean
  toggle: () => void
  advance: (currentSessionID?: string) => void
  inboxCount: number
  outboxCount: number
  topTitle: string | undefined
  pending: boolean
  isError: boolean
  projectID: string | undefined
}

const InboxMonitorContext = createContext<InboxMonitorContextValue | null>(null)

/**
 * Move between Inbox sessions on explicit actions only: turning the monitor on,
 * Done, Send, and saving a draft. Manual navigation and inbox updates never
 * redirect the open view.
 */
export function InboxMonitorProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const matches = useMatches()
  const { lowerSingular } = useSessionWording()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  const routeParams = useMemo(() => {
    let projectID: string | undefined
    let sessionID: string | undefined
    for (const match of matches) {
      if (match.params.projectId) projectID = match.params.projectId
      if (match.params.sessionId) sessionID = match.params.sessionId
    }
    return { projectID, sessionID }
  }, [matches])

  const projectOptions = useMemo(() => canonicalProjects(projects), [projects])

  const project = useMemo(() => {
    const fromRoute = canonicalProject(projects, routeParams.projectID)
    if (fromRoute) return fromRoute
    return canonicalProject(projects, readLastProject()) ?? projectOptions[0] ?? null
  }, [projectOptions, projects, routeParams.projectID])

  const { inbox, outboxCount, top, pending, isError } = useInboxSessions(
    project?.id ?? null,
    project?.canonical ?? null
  )
  const [active, setActiveState] = useState(readInboxMonitor)
  /** A one-shot jump requested while the Inbox was still loading. */
  const pendingJump = useRef<{ pathname: string } | null>(null)
  const onHome = location.pathname === '/'
  /** Inbox IDs already present when the start view was opened. */
  const seenOnHome = useRef<Set<string> | null>(null)

  const goTo = useCallback(
    (sessionID: string | undefined) => {
      const target = project && sessionID ? `/p/${project.id}/s/${sessionID}` : '/'
      if (location.pathname !== target) navigate(target, { replace: true })
    },
    [location.pathname, navigate, project]
  )

  const jumpToFirst = useCallback(() => {
    goTo(top?.id)
  }, [goTo, top?.id])

  const setActive = useCallback((next: boolean) => {
    setActiveState(next)
    saveInboxMonitor(next)
  }, [])

  const toggle = useCallback(() => {
    if (active) {
      pendingJump.current = null
      setActive(false)
      return
    }

    setActive(true)
    if (pending) {
      pendingJump.current = { pathname: location.pathname }
      return
    }
    jumpToFirst()
  }, [active, jumpToFirst, location.pathname, pending, setActive])

  /**
   * Resume a jump requested while the Inbox was loading. Any manual navigation
   * before it resolves cancels the jump so users are never redirected later.
   */
  useEffect(() => {
    const request = pendingJump.current
    if (!request) return
    if (location.pathname !== request.pathname || !active) {
      pendingJump.current = null
      return
    }
    if (pending) return
    pendingJump.current = null
    jumpToFirst()
  }, [active, jumpToFirst, location.pathname, pending])

  /**
   * While monitoring from the start view, open a session as soon as it newly
   * enters the Inbox. Sessions already there when the view opened never
   * redirect, so manual navigation and the switch stay usable.
   */
  useEffect(() => {
    if (!active || !onHome) {
      seenOnHome.current = null
      return
    }
    if (pending) return

    const ids = new Set(inbox.map((session) => session.id))
    const previous = seenOnHome.current
    seenOnHome.current = ids

    if (previous === null) return

    const arrived = inbox.find((session) => !previous.has(session.id))
    if (arrived) goTo(arrived.id)
  }, [active, goTo, inbox, onHome, pending])

  const advance = useCallback(
    (currentSessionID?: string) => {
      if (!active) return
      const next = currentSessionID
        ? inbox.find((session) => session.id !== currentSessionID)
        : inbox[0]
      goTo(next?.id)
    },
    [active, goTo, inbox]
  )

  const topTitle = top ? top.title || `Untitled ${lowerSingular}` : undefined

  const value = useMemo(
    () => ({
      active,
      toggle,
      advance,
      inboxCount: inbox.length,
      outboxCount,
      topTitle,
      pending,
      isError,
      projectID: project?.id,
    }),
    [active, advance, inbox.length, isError, outboxCount, pending, project?.id, toggle, topTitle]
  )

  return <InboxMonitorContext.Provider value={value}>{children}</InboxMonitorContext.Provider>
}

export function useInboxMonitor() {
  const value = useContext(InboxMonitorContext)
  if (!value) throw new Error('useInboxMonitor must be used inside InboxMonitorProvider')
  return value
}
