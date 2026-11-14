import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ClaraSession } from '@clara/api-contract'
import type { SessionMailboxSignals } from '@clara/shared-types'
import { discardEmptyDraft } from '@/features/chat/use-discard-empty-draft'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { queryKeys } from '@/lib/query-keys'
import { readDraft } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

/** Let a brief settle before the list sweep removes it. */
export const EMPTY_DRAFT_GRACE_MS = 60_000
const PRUNE_DELAY_MS = 1_000
const PRUNE_BATCH_SIZE = 8

/** One attempt per brief per page load, shared by every sidebar instance. */
const inspected = new Set<string>()

export type PruneEmptyDraftStatus = {
  session: ClaraSession
  signals: SessionMailboxSignals | undefined
  running: boolean
  hasLocalDraft: boolean
  now: number
}

/**
 * A listed brief is safe to remove when it is untitled, idle, and has no user
 * or assistant message, no pending request, and nothing saved for it locally.
 */
export function shouldPruneEmptyDraft(status: PruneEmptyDraftStatus): boolean {
  const { session, signals } = status
  if (session.title?.trim()) return false
  if (isArchivedSession(session) || isSnoozedSession(session)) return false
  if (status.running || status.hasLocalDraft) return false
  if (!signals || signals.last !== 'none' || signals.awaitingInput) return false
  return status.now - session.time.updated >= EMPTY_DRAFT_GRACE_MS
}

/**
 * Sweep old untitled empty briefs from the session list. It runs only outside
 * the chat view, where the composer window is not mounted, and re-confirms each
 * brief with the harness before deleting it.
 */
export function usePruneEmptyDrafts({
  sessions,
  signals,
  running,
  enabled,
}: {
  sessions: ClaraSession[]
  signals: ReadonlyMap<string, SessionMailboxSignals>
  running: Readonly<Record<string, unknown>> | undefined
  enabled: boolean
}) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !client) return
    const now = Date.now()
    const candidates = sessions
      .filter((session) =>
        shouldPruneEmptyDraft({
          session,
          signals: signals.get(session.id),
          running: Boolean(running?.[session.id]),
          hasLocalDraft: readDraft(session.id).trim().length > 0,
          now,
        })
      )
      .filter((session) => !inspected.has(session.id))
      .slice(0, PRUNE_BATCH_SIZE)

    if (candidates.length === 0) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let removed = false
        for (const session of candidates) {
          if (cancelled) return
          if (inspected.has(session.id)) continue
          inspected.add(session.id)
          const result = await discardEmptyDraft(client, session.id, () => {
            return !cancelled && readDraft(session.id).trim().length === 0
          })
          if (cancelled) return
          if (result !== 'deleted') continue
          removed = true
          queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
          queryClient.removeQueries({ queryKey: queryKeys.messages(session.id) })
          queryClient.removeQueries({ queryKey: queryKeys.sessionInbox(session.id) })
          queryClient.removeQueries({ queryKey: queryKeys.sessionMailbox(session.id) })
        }
        if (removed) void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      })()
    }, PRUNE_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [client, enabled, queryClient, running, sessions, signals])
}
