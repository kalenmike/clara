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
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ClaraEvent } from '@clara/api-contract'
import { toast } from 'sonner'
import { saveLastAgent } from '@/features/agents/default-agent'
import { chatStore } from '@/features/chat/chat-store'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'offline'

type EventListener = (event: ClaraEvent) => void

type EventContextValue = {
  live: boolean
  state: StreamState
  lastEventAt: number
  lastError: string | null
  /** Observe raw events without opening another SSE connection. */
  subscribe: (listener: EventListener) => () => void
}

const EventContext = createContext<EventContextValue>({
  live: false,
  state: 'offline',
  lastEventAt: 0,
  lastError: null,
  subscribe: () => () => {},
})

/** The server writes an SSE heartbeat every 15 seconds. */
const HEARTBEAT_MS = 15_000
/** Three missed heartbeats mean the socket is half-open rather than idle. */
const STALL_MS = HEARTBEAT_MS * 3
const WATCHDOG_MS = 5_000
const MAX_BACKOFF_MS = 15_000
const RECONNECT_NOTICE_MS = 5_000
/** A connection must survive this long before it resets the backoff. */
const STABLE_MS = 10_000

const MESSAGE_EVENTS = new Set([
  'session.synthetic',
  'session.skill.activated',
  'session.shell.started',
  'session.shell.ended',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.retry.scheduled',
  'session.revert.staged',
  'session.revert.cleared',
  'session.revert.committed',
])

export function EventProvider({ children }: { children: ReactNode }) {
  const { client, generation } = useConnection()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)
  const [state, setState] = useState<StreamState>('offline')
  const [lastEventAt, setLastEventAt] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const listeners = useRef(new Set<EventListener>())

  const subscribe = useCallback((listener: EventListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!client) {
      setLive(false)
      setState('offline')
      return
    }

    const controller = new AbortController()
    let retry = 0
    let cancelSleep: (() => void) | null = null
    let active: AbortController | null = null
    let connected = false
    let hadFailure = false
    let downSince = 0
    let lastActivity = Date.now()
    let stableTimer: number | null = null
    const timers = new Map<string, number>()

    setState('connecting')

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms)
        cancelSleep = () => {
          window.clearTimeout(timer)
          resolve()
        }
      })

    const invalidateSoon = (key: string, queryKey: readonly unknown[]) => {
      const existing = timers.get(key)
      if (existing) window.clearTimeout(existing)
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key)
          void queryClient.invalidateQueries({ queryKey })
        }, 300)
      )
    }

    /** Runs on every raw chunk, including keepalive comments. */
    const markAlive = () => {
      lastActivity = Date.now()
      if (connected) return
      connected = true
      if (stableTimer === null) {
        stableTimer = window.setTimeout(() => {
          stableTimer = null
          retry = 0
        }, STABLE_MS)
      }
      setLive(true)
      setState('live')
      setLastError(null)
      if (hadFailure) {
        // Events that arrived while the stream was down were never replayed.
        chatStore.resetHistories()
        chatStore.resetStatuses()
        void queryClient.resetQueries({ queryKey: ['messages'] })
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'messages',
        })
        if (Date.now() - downSince > RECONNECT_NOTICE_MS) {
          toast.success('Reconnected', { id: 'stream-reconnected' })
        }
        hadFailure = false
        downSince = 0
      }
    }

    const markDown = () => {
      if (stableTimer !== null) {
        window.clearTimeout(stableTimer)
        stableTimer = null
      }
      connected = false
      if (!hadFailure) {
        hadFailure = true
        downSince = Date.now()
      }
      setLive(false)
      setState('reconnecting')
    }

    const handleEvent = (event: ClaraEvent) => {
      markAlive()
      setLastEventAt(Date.now())
      for (const listener of listeners.current) {
        try {
          listener(event)
        } catch (cause) {
          console.warn('Event listener failed', cause)
        }
      }
      if (event.type === 'session.execution.failed') {
        const error = event.data.error
        toast.error('Run failed', {
          id: `run-failed:${event.data.sessionID}`,
          description: error.status ? `${error.message} (${error.status})` : error.message,
        })
      }
      chatStore.dispatch(event)
      handleInvalidation(event, queryClient, invalidateSoon)
    }

    const run = async () => {
      while (!controller.signal.aborted) {
        const attempt = new AbortController()
        active = attempt
        lastActivity = Date.now()
        const abortAttempt = () => attempt.abort()
        controller.signal.addEventListener('abort', abortAttempt, { once: true })

        try {
          for await (const event of client.event.subscribe({
            signal: attempt.signal,
            onActivity: markAlive,
          })) {
            handleEvent(event)
          }
        } catch (cause) {
          if (!controller.signal.aborted) setLastError(describeStreamError(cause))
        } finally {
          controller.signal.removeEventListener('abort', abortAttempt)
          if (active === attempt) active = null
        }

        if (controller.signal.aborted) break
        markDown()
        retry += 1
        await sleep(backoff(retry))
      }
    }

    // A half-open SSE socket never rejects, so the loop above would wait forever.
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) active?.abort()
    }, WATCHDOG_MS)

    void run()

    return () => {
      controller.abort()
      active?.abort()
      window.clearInterval(watchdog)
      if (stableTimer !== null) window.clearTimeout(stableTimer)
      cancelSleep?.()
      for (const timer of timers.values()) window.clearTimeout(timer)
      setLive(false)
    }
    // generation forces a fresh subscription after a manual reconnect.
  }, [client, generation, queryClient])

  const value = useMemo(
    () => ({ live, state, lastEventAt, lastError, subscribe }),
    [live, state, lastEventAt, lastError, subscribe]
  )

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

function describeStreamError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'The event stream disconnected.'
}

function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.min(attempt, 4), MAX_BACKOFF_MS)
  // Jitter keeps several tabs from reconnecting in lockstep.
  return base * (0.8 + Math.random() * 0.4)
}

function handleInvalidation(
  event: ClaraEvent,
  queryClient: QueryClient,
  invalidateSoon: (key: string, queryKey: readonly unknown[]) => void
) {
  const data = 'data' in event ? (event.data as { sessionID?: string }) : undefined
  const sessionID = data?.sessionID

  switch (event.type) {
    case 'project.updated':
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.archivedProjects })
      return

    case 'session.created':
    case 'session.deleted':
    case 'session.renamed':
    case 'session.archived':
    case 'session.unarchived':
    case 'session.forked':
    case 'session.moved':
      if (event.type === 'session.deleted' && sessionID) chatStore.forget(sessionID)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (event.type === 'session.created' || event.type === 'session.deleted') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        void queryClient.invalidateQueries({ queryKey: ['project-presence'] })
        void queryClient.invalidateQueries({ queryKey: ['project-stats'] })
      } else if (
        event.type === 'session.archived' ||
        event.type === 'session.unarchived' ||
        event.type === 'session.forked'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['project-stats'] })
      }
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
        if (event.type === 'session.forked') {
          invalidateSoon(`messages:${sessionID}`, queryKeys.messages(sessionID))
        }
      }
      return

    case 'session.metadata.updated':
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
      }
      return

    case 'session.viewed':
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
      }
      return

    case 'session.idle':
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
      // Invalidating `sessions` also refreshes the active-session map.
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissions })
      invalidateSoon('vcs', ['vcs'])
      // One `git log` per finished turn, when commits are most likely.
      invalidateSoon('git-commits', ['git', 'commits'])
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
        invalidateSoon(`messages:${sessionID}`, queryKeys.messages(sessionID))
        invalidateSoon(`inbox:${sessionID}`, queryKeys.sessionInbox(sessionID))
        invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      }
      return

    case 'session.compaction.started':
    case 'session.compaction.ended':
    case 'session.compaction.failed':
    case 'session.revert.staged':
    case 'session.revert.cleared':
    case 'session.revert.committed':
      // These can replace or remove messages, so cached older pages are stale.
      if (sessionID) {
        chatStore.resetHistory(sessionID)
        void queryClient.resetQueries({ queryKey: queryKeys.messages(sessionID) })
      }
      return

    case 'session.status':
      invalidateSoon('active-sessions', queryKeys.activeSessions)
      return

    case 'session.execution.started':
      invalidateSoon('active-sessions', queryKeys.activeSessions)
      if (sessionID) {
        invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      }
      return

    case 'session.inbox.delivered':
      if (sessionID) {
        invalidateSoon(`inbox:${sessionID}`, queryKeys.sessionInbox(sessionID))
        invalidateSoon(`messages:${sessionID}`, queryKeys.messages(sessionID))
        invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      }
      return

    case 'session.inbox.enqueued':
    case 'session.inbox.cancelled':
    case 'session.inbox.delivery.changed':
      if (sessionID) {
        invalidateSoon(`inbox:${sessionID}`, queryKeys.sessionInbox(sessionID))
        invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      }
      return

    case 'session.step.started':
      if (sessionID) {
        invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      }
      return

    case 'session.agent.selected':
      saveLastAgent(event.data.agent)
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }
      return

    case 'session.model.selected':
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }
      return

    case 'permission.asked':
    case 'permission.replied':
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissions })
      return

    case 'vcs.branch.updated':
      void queryClient.invalidateQueries({ queryKey: ['vcs'] })
      // A commit moves HEAD; refresh the log once, not on every file write.
      invalidateSoon('git-commits', ['git', 'commits'])
      return

    case 'worktree.updated':
    case 'worktree.resolved':
      void queryClient.invalidateQueries({ queryKey: ['git', 'worktrees'] })
      return

    case 'filesystem.changed':
      invalidateSoon('vcs', ['vcs'])
      return

    case 'form.created': {
      const { sessionID } = event.data.form
      void queryClient.invalidateQueries({ queryKey: queryKeys.forms(sessionID) })
      invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      return
    }

    case 'form.replied':
    case 'form.cancelled': {
      const { sessionID } = event.data
      void queryClient.invalidateQueries({ queryKey: queryKeys.forms(sessionID) })
      invalidateSoon(`mailbox:${sessionID}`, queryKeys.sessionMailbox(sessionID))
      return
    }

    default:
      if (sessionID && MESSAGE_EVENTS.has(event.type)) {
        invalidateSoon(`messages:${sessionID}`, queryKeys.messages(sessionID))
      }
  }
}

export function useEventStream() {
  return useContext(EventContext)
}
