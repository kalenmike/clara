import type { QueryClient } from '@tanstack/react-query'
import type { Project, SessionInfo } from '@opencode/client'
import type { OpenCodeClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { canonicalProjects } from '@/features/projects/use-projects'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { loadSessionMailboxSignals } from '@/features/sessions/session-mailbox-signals'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { resolveAttentionKind, type AttentionKind } from './attention'

export type SessionAttention = {
  kind: AttentionKind
  session: SessionInfo
}

export async function getSessionInfo(
  client: OpenCodeClient,
  queryClient: QueryClient,
  sessionID: string
): Promise<SessionInfo> {
  const cached = queryClient.getQueryData<SessionInfo>(queryKeys.session(sessionID))
  if (cached) return cached

  const session = await client.session.get({ sessionID })
  queryClient.setQueryData(queryKeys.session(sessionID), session)
  return session
}

/**
 * Re-read the mailbox signals for a session that just finished. Live events are
 * the trigger; this decides which of the four Inbox states the session is in.
 */
export async function loadSessionAttention(
  client: OpenCodeClient,
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
function projectIDFromList(projects: Project[], session: SessionInfo): string | null {
  const direct = projects.find((project) => project.id === session.projectID)
  if (direct) return direct.id
  return (
    canonicalProjects(projects).find((project) => project.canonical === session.location.directory)
      ?.id ?? null
  )
}

export async function resolveProjectID(
  client: OpenCodeClient,
  queryClient: QueryClient,
  session: SessionInfo
): Promise<string | null> {
  const cached = queryClient.getQueryData<Project[]>(queryKeys.projects)
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
