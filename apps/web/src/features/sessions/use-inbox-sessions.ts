import { useMemo } from 'react'
import { usePendingPermissions } from '@/features/chat/use-permissions'
import { useSessionPolicy } from '@/features/notifications/session-policy'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox } from '@/features/sessions/session-sections'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import { useActiveSessions, useSessions } from '@/features/sessions/use-sessions'

/** Inbox sessions for a project, newest first, with the data needed to jump to them. */
export function useInboxSessions(
  projectID: string | null,
  directory: string | null,
  harnessID?: string
) {
  const { isAutomation } = useSessionPolicy()
  const sessionsQuery = useSessions(projectID, '', Boolean(projectID && directory))
  const activeQuery = useActiveSessions()
  const permissionsQuery = usePendingPermissions(directory ?? undefined, harnessID)

  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const mailboxSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !isArchivedSession(session) && !isSnoozedSession(session) && !isAutomation?.(session)
      ),
    [sessions, isAutomation]
  )
  const { signals, pending: mailboxesPending } = useSessionMailboxSignals(mailboxSessions)
  const awaitingInput = useMemo(
    () => new Set((permissionsQuery.data ?? []).map((request) => request.sessionID)),
    [permissionsQuery.data]
  )
  const groups = useMemo(
    () => groupSessionsByMailbox(mailboxSessions, signals, activeQuery.data, awaitingInput),
    [mailboxSessions, signals, activeQuery.data, awaitingInput]
  )

  return {
    inbox: groups.inbox,
    outboxCount: groups.outbox.length,
    top: groups.inbox[0],
    pending:
      sessionsQuery.isPending ||
      activeQuery.isPending ||
      permissionsQuery.isPending ||
      (mailboxSessions.length > 0 && mailboxesPending),
    isError: sessionsQuery.isError,
  }
}
