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
import type { ClaraEvent, ClaraSession } from '@clara/api-contract'
import { toast } from 'sonner'
import { saveLastAgent } from '@/features/agents/default-agent'
import { chatStore } from '@/features/chat/chat-store'
import {
  aggregateStreamState,
  onlineHarnessIDs,
  type StreamState,
} from '@/features/harness/stream-state'
import {
  superviseHarnessStream,
  type HarnessStreamHandle,
} from '@/features/harness/stream-supervisor'
import { useHarnesses } from '@/features/projects/use-projects'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type { StreamState }

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

const RECONNECT_NOTICE_MS = 5_000

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
  const harnessesQuery = useHarnesses()
  const [state, setState] = useState<StreamState>('offline')
  const [lastEventAt, setLastEventAt] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const listeners = useRef(new Set<EventListener>())

  const onlineIDs = useMemo(
    () => (harnessesQuery.isSuccess ? onlineHarnessIDs(harnessesQuery.data ?? []) : []),
    [harnessesQuery.data, harnessesQuery.isSuccess]
  )
  /** One stream per online harness. Offline harnesses never open a socket. */
  const streamTargets = harnessesQuery.isSuccess ? onlineIDs.join('\u0000') : ''

  const subscribe = useCallback((listener: EventListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!client) {
      setState('offline')
      return
    }

    const harnessIDs: string[] = streamTargets ? streamTargets.split('\u0000') : []
    const states = new Map<string, StreamState>()
    const handles: HarnessStreamHandle[] = []
    const timers = new Map<string, number>()

    const publish = () => setState(aggregateStreamState([...states.values()]))

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

    const handleEvent = (event: ClaraEvent) => {
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

    /** A dropped stream reconnected: nothing that arrived while it was down was replayed. */
    const recovered = (downForMs: number) => {
      chatStore.resetHistories()
      void queryClient.resetQueries({ queryKey: ['messages'] })
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'messages',
      })
      if (downForMs > RECONNECT_NOTICE_MS) {
        toast.success('Reconnected', { id: 'stream-reconnected' })
      }
    }

    for (const harnessID of harnessIDs) {
      const key = harnessID
      states.set(key, 'connecting')
      handles.push(
        superviseHarnessStream({
          client,
          harnessID,
          onEvent: handleEvent,
          onState: (next) => {
            states.set(key, next)
            if (next === 'live') setLastError(null)
            publish()
          },
          onError: (message) => setLastError(message),
          onRecovered: recovered,
        })
      )
    }
    publish()

    return () => {
      for (const handle of handles) handle.stop()
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
    // generation forces fresh subscriptions after a manual reconnect.
  }, [client, generation, queryClient, streamTargets])

  const value = useMemo(
    () => ({ live: state === 'live', state, lastEventAt, lastError, subscribe }),
    [state, lastEventAt, lastError, subscribe]
  )

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.archivedSessionsRoot })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.archivedSessionsRoot })
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
      invalidateSoon('activity', queryKeys.activitySessions)
      return

    case 'session.metadata.updated':
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
      }
      invalidateSoon('activity', queryKeys.activitySessions)
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
      invalidateSoon('activity', queryKeys.activitySessions)
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
      // Reconcile the run state before another poll can apply a stale map.
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeSessions })
      return

    case 'session.execution.started':
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeSessions })
      invalidateSoon('activity', queryKeys.activitySessions)
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
      if (sessionID) {
        const session = queryClient.getQueryData<ClaraSession>(queryKeys.session(sessionID))
        saveLastAgent(session?.harnessID, event.data.agent)
      }
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
