import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ClaraSession } from '@clara/api-contract'
import { useComposer } from '@/features/chat/composer-provider'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import type { ClaraClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { readDraft } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

/** Wait out StrictMode's mount/unmount probe before a real discard. */
const DISCARD_DELAY_MS = 250

export type EmptyDraftStatus = {
  sessionID: string | undefined
  session: ClaraSession | undefined
  /** Any user or assistant message; internal selection notes do not count. */
  hasConversation: boolean
  /** Composer text or attachments, live or saved in local storage. */
  hasLocalDraft: boolean
  hasRequests: boolean
  busy: boolean
}

/**
 * A brief is only worth keeping when it has a title, content, or something
 * waiting. Leaving an untitled empty brief should not add another Drafts row.
 */
export function shouldDiscardEmptyDraft(status: EmptyDraftStatus): boolean {
  const { session } = status
  if (!session) return false
  if (session.title?.trim()) return false
  if (status.hasConversation || status.hasLocalDraft || status.hasRequests) return false
  if (status.busy) return false
  return !isArchivedSession(session) && !isSnoozedSession(session)
}

export type DiscardResult = 'deleted' | 'kept' | 'failed'

/**
 * Confirm with the harness before removing a brief. The newest message is often
 * an internal selection or idle note, so only user and assistant messages count
 * as content. Local query data can also lag a send or a saved draft that was
 * still in flight when the view closed.
 */
export async function discardEmptyDraft(
  client: ClaraClient,
  sessionID: string,
  stillAbandoned: () => boolean
): Promise<DiscardResult> {
  try {
    const [users, assistants, inbox] = await Promise.all([
      client.message.list({ sessionID, order: 'desc', limit: 1, type: 'user' }),
      client.message.list({ sessionID, order: 'desc', limit: 1, type: 'assistant' }),
      client.session.inbox.list({ sessionID }),
    ])
    if (users.data.length > 0 || assistants.data.length > 0 || inbox.length > 0) return 'kept'
    if (!stillAbandoned()) return 'kept'
    await client.session.remove({ sessionID })
    return 'deleted'
  } catch {
    return 'failed'
  }
}

/**
 * Remove an untitled empty brief when the view leaves it with no composer text,
 * no saved draft, and nothing else pending. The decision follows the session as
 * the route changes, then rechecks the live composer before writing.
 */
export function useDiscardEmptyDraft(status: EmptyDraftStatus) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const { draftState, closeTab } = useComposer()

  const statuses = useRef(new Map<string, EmptyDraftStatus>())
  const timers = useRef(new Map<string, number>())
  const live = useRef({ client, draftState, closeTab })

  if (status.sessionID) statuses.current.set(status.sessionID, status)
  live.current = { client, draftState, closeTab }

  useEffect(() => {
    const sessionID = status.sessionID
    if (!sessionID) return
    const statusMap = statuses.current
    const timerMap = timers.current

    const pending = timerMap.get(sessionID)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      timerMap.delete(sessionID)
    }
    for (const key of statusMap.keys()) {
      if (key !== sessionID) statusMap.delete(key)
    }

    const discard = async () => {
      const current = live.current
      if (!current.client) return
      if (current.draftState(sessionID)) return
      if (readDraft(sessionID).trim().length > 0) return

      const discarded = await discardEmptyDraft(current.client, sessionID, () => {
        if (live.current.draftState(sessionID)) return false
        return readDraft(sessionID).trim().length === 0
      })
      if (discarded !== 'deleted') return

      live.current.closeTab(sessionID)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      window.setTimeout(() => {
        queryClient.removeQueries({ queryKey: queryKeys.session(sessionID) })
        queryClient.removeQueries({ queryKey: queryKeys.messages(sessionID) })
        queryClient.removeQueries({ queryKey: queryKeys.sessionInbox(sessionID) })
        queryClient.removeQueries({ queryKey: queryKeys.sessionMailbox(sessionID) })
      }, 0)
    }

    return () => {
      const leaving = statusMap.get(sessionID)
      if (!leaving || !shouldDiscardEmptyDraft(leaving)) return

      const timer = window.setTimeout(() => {
        timerMap.delete(sessionID)
        void discard()
      }, DISCARD_DELAY_MS)
      timerMap.set(sessionID, timer)
    }
  }, [queryClient, status.sessionID])
}
