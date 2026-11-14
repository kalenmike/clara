import type { QueryClient } from '@tanstack/react-query'
import type { ClaraProject, ClaraSession } from '@clara/api-contract'
import type { ClaraClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { getSessionInfo } from '@/features/sessions/session-cache'
import { loadSessionMailboxSignals } from '@/features/sessions/session-mailbox-signals'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { resolveAttentionKind, type AttentionKind } from './attention'

export type SessionAttention = {
  kind: AttentionKind
  session: ClaraSession
}

/**
 * Re-read the mailbox signals for a session that just finished. Live events are
 * the trigger; this decides which of the four Inbox states the session is in.
 */
export async function loadSessionAttention(
  client: ClaraClient,
  queryClient: QueryClient,
  sessionID: string
): Promise<SessionAttention | null> {
  const session = await getSessionInfo(client, queryClient, sessionID)
  if (isArchivedSession(session) || isSnoozedSession(session)) return null

  const signals = await loadSessionMailboxSignals(client, sessionID)
  const kind = resolveAttentionKind(signals, session.agent, false)
  return kind ? { kind, session } : null
}

/**
 * Find the project that owns a session so a notification can open the right
 * route. Prefer the session's project ID, which survives a move to a worktree,
 * then fall back to matching its location against a project directory.
 */
function projectIDFromList(projects: ClaraProject[], session: ClaraSession): string | null {
  const direct = projects.find((project) => project.id === session.projectID)
  if (direct) return direct.id
  const directory = session.location.directory
  return (
    projects.find((project) =>
      project.workspaces.some(
        (workspace) =>
          (workspace.canonical === directory || workspace.directory === directory) &&
          (!session.harnessID || workspace.harnessID === session.harnessID)
      )
    )?.id ?? null
  )
}

export async function resolveProjectID(
  client: ClaraClient,
  queryClient: QueryClient,
  session: ClaraSession
): Promise<string | null> {
  const cached = queryClient.getQueryData<ClaraProject[]>(queryKeys.projects)
  const cachedID = cached ? projectIDFromList(cached, session) : null
  if (cachedID) return cachedID

  try {
    const projects = await client.project.list()
    queryClient.setQueryData(queryKeys.projects, projects)
    return projectIDFromList(projects, session)
  } catch {
    return session.projectID === 'global' ? null : session.projectID
  }
}
