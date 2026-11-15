import type { ClaraSession } from '@clara/api-contract'
import { usePendingPermissions } from '@/features/chat/use-permissions'
import { resolveAttentionKind } from '@/features/notifications/attention'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { resolveSessionStatus, type SessionStatusKind } from '@/features/sessions/session-status'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import { useActiveSessions } from '@/features/sessions/use-sessions'

/**
 * The composer tab's status mark. It reads the same active map, mailbox
 * signals, and pending permissions as the sidebar row, so a tab and its
 * sidebar entry cannot disagree about a running, blocked, failed, or finished
 * session.
 */
export function useComposerTabStatus(session: ClaraSession | undefined): SessionStatusKind {
  const activeQuery = useActiveSessions()
  const { signals } = useSessionMailboxSignals(session ? [session] : [])
  const permissions = usePendingPermissions(session?.location.directory, session?.harnessID, {
    enabled: Boolean(session),
  })

  const awaitingInput = Boolean(
    session && (permissions.data ?? []).some((request) => request.sessionID === session.id)
  )
  const attention = resolveAttentionKind(
    session ? signals.get(session.id) : undefined,
    session?.agent,
    awaitingInput
  )

  return resolveSessionStatus({
    snoozed: Boolean(session && isSnoozedSession(session)),
    active: Boolean(session && activeQuery.data?.[session.id]),
    attention: session && !isArchivedSession(session) ? attention : null,
  })
}
