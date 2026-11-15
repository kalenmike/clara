import { useEffect } from 'react'
import { chatStore } from '@/features/chat/chat-store'
import { useActiveSessions } from '@/features/sessions/use-sessions'

/**
 * Reconcile the chat store's run state with the server's active-session map.
 * The event stream is live-only, so an already-running session would otherwise
 * sit at the store's idle default, and a run whose terminal event was missed
 * would stay busy. Skip while a fetch is in flight so a response that started
 * before the newest live event cannot overwrite it.
 */
export function useActiveSessionStatus(sessionID: string) {
  const activeQuery = useActiveSessions()
  const updatedAt = activeQuery.dataUpdatedAt
  const fetching = activeQuery.isFetching
  const running = sessionID ? activeQuery.data?.[sessionID]?.type === 'running' : false

  useEffect(() => {
    if (!sessionID || !activeQuery.isSuccess || fetching) return
    chatStore.seedStatus(sessionID, running ? { type: 'busy' } : { type: 'idle' })
  }, [activeQuery.isSuccess, fetching, running, sessionID, updatedAt])
}
