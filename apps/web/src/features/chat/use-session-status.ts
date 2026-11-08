import { useEffect } from 'react'
import { chatStore } from '@/features/chat/chat-store'
import { useActiveSessions } from '@/features/sessions/use-sessions'

/**
 * Seed the chat store's run state from the server's active-session map. The
 * event stream is live-only, so an already-running session would otherwise sit
 * at the store's idle default until its next status change.
 */
export function useActiveSessionStatus(sessionID: string) {
  const activeQuery = useActiveSessions()
  const updatedAt = activeQuery.dataUpdatedAt
  const running = sessionID ? activeQuery.data?.[sessionID]?.type === 'running' : false

  useEffect(() => {
    if (!sessionID || !activeQuery.isSuccess) return
    chatStore.seedStatus(sessionID, running ? { type: 'busy' } : { type: 'idle' })
  }, [activeQuery.isSuccess, running, sessionID, updatedAt])
}
