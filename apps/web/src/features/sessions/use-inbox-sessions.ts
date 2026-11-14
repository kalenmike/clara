import { useMemo } from 'react'
import type { ClaraProjectWorkspace } from '@clara/api-contract'
import { useWorkspacePendingPermissions } from '@/features/chat/use-permissions'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox } from '@/features/sessions/session-sections'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import { useActiveSessions, useSessions } from '@/features/sessions/use-sessions'

/** Inbox sessions for a project, newest first, with the data needed to jump to them. */
export function useInboxSessions(
  projectID: string | null,
  workspaces: readonly ClaraProjectWorkspace[] | undefined
) {
  const hasWorkspace = Boolean(workspaces?.some((workspace) => workspace.linked))
  const sessionsQuery = useSessions(projectID, '', Boolean(projectID && hasWorkspace))
  const activeQuery = useActiveSessions()
  const permissions = useWorkspacePendingPermissions(workspaces)
  const permissionsPending = permissions.pending

  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const mailboxSessions = useMemo(
    () => sessions.filter((session) => !isArchivedSession(session) && !isSnoozedSession(session)),
    [sessions]
  )
  const { signals, pending: mailboxesPending } = useSessionMailboxSignals(mailboxSessions)
  const awaitingInput = useMemo(
    () => new Set(permissions.requests.map((request) => request.sessionID)),
    [permissions.requests]
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
      permissionsPending ||
      (mailboxSessions.length > 0 && mailboxesPending),
    isError: sessionsQuery.isError,
  }
}
