import { useMemo } from 'react'
import { usePendingPermissions } from '@/features/chat/use-permissions'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox } from '@/features/sessions/session-sections'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import { useActiveSessions, useSessions } from '@/features/sessions/use-sessions'

/** Inbox sessions for a project, newest first, with the data needed to jump to them. */
export function useInboxSessions(directory: string) {
  const sessionsQuery = useSessions(directory, '')
  const activeQuery = useActiveSessions()
  const permissionsQuery = usePendingPermissions(directory)

  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const mailboxSessions = useMemo(
    () => sessions.filter((session) => !isArchivedSession(session)),
    [sessions]
  )
  const { signals, pending: mailboxesPending } = useSessionMailboxSignals(mailboxSessions)
  const awaitingInput = useMemo(
    () => new Set((permissionsQuery.data ?? []).map((request) => request.sessionID)),
    [permissionsQuery.data]
  )
  const inbox = useMemo(
    () => groupSessionsByMailbox(mailboxSessions, signals, activeQuery.data, awaitingInput).inbox,
    [mailboxSessions, signals, activeQuery.data, awaitingInput]
  )

  return {
    inbox,
    top: inbox[0],
    pending:
      sessionsQuery.isPending ||
      activeQuery.isPending ||
      permissionsQuery.isPending ||
      (mailboxSessions.length > 0 && mailboxesPending),
    isError: sessionsQuery.isError,
  }
}
