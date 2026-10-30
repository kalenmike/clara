/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { V2Event } from '@opencode/client'
import { chatStore } from '@/features/chat/chat-store'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

type EventContextValue = {
  live: boolean
  lastEventAt: number
}

const EventContext = createContext<EventContextValue>({ live: false, lastEventAt: 0 })

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
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)
  const [lastEventAt, setLastEventAt] = useState(0)

  useEffect(() => {
    if (!client) {
      setLive(false)
      return
    }

    const controller = new AbortController()
    let retry = 0
    let cancelSleep: (() => void) | null = null
    const timers = new Map<string, number>()

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

    const handleEvent = (event: V2Event) => {
      setLive(true)
      setLastEventAt(Date.now())
      chatStore.dispatch(event)
      handleInvalidation(event, queryClient, invalidateSoon)
    }

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of client.event.subscribe({ signal: controller.signal })) {
            retry = 0
            handleEvent(event)
          }
        } catch {
          if (controller.signal.aborted) break
          setLive(false)
        }

        if (controller.signal.aborted) break
        retry += 1
        await sleep(Math.min(1000 * 2 ** retry, 15000))
      }
    }

    void run()

    return () => {
      controller.abort()
      cancelSleep?.()
      for (const timer of timers.values()) window.clearTimeout(timer)
      setLive(false)
    }
  }, [client, queryClient])

  const value = useMemo(() => ({ live, lastEventAt }), [live, lastEventAt])

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

function handleInvalidation(
  event: V2Event,
  queryClient: QueryClient,
  invalidateSoon: (key: string, queryKey: readonly unknown[]) => void
) {
  const data = 'data' in event ? (event.data as { sessionID?: string }) : undefined
  const sessionID = data?.sessionID

  switch (event.type) {
    case 'session.created':
    case 'session.deleted':
    case 'session.renamed':
    case 'session.archived':
    case 'session.unarchived':
    case 'session.forked':
    case 'session.moved':
    case 'session.idle':
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
        invalidateSoon(`messages:${sessionID}`, queryKeys.messages(sessionID))
      }
      return

    case 'session.agent.selected':
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

    case 'form.created':
    case 'form.replied':
    case 'form.cancelled': {
      const formData = event.data as { sessionID?: string }
      if (formData.sessionID) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.forms(formData.sessionID) })
      }
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
