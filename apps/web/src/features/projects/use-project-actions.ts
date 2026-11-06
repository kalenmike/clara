import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import type { OpenCodeClient } from '@/lib/client'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { runWithConcurrency } from '@/lib/concurrency'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Keep each request small while still leaving room for large projects. */
export const PROJECT_SESSION_PAGE_SIZE = 200

/** Bound how many writes run at once so a large project does not flood the server. */
export const PROJECT_ACTION_CONCURRENCY = 4

/**
 * Load every session in a project, including archived ones. The server returns
 * a cursor when more sessions exist, so totals are not limited by one page.
 */
export async function listAllProjectSessions(
  client: OpenCodeClient,
  projectID: string
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < 100; page += 1) {
    const response = await client.session.list({
      project: projectID,
      limit: PROJECT_SESSION_PAGE_SIZE,
      cursor,
    })
    for (const session of response.data) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      sessions.push(session)
    }

    const next = response.cursor.next ?? undefined
    if (!next || cursors.has(next)) break
    cursors.add(next)
    cursor = next
  }

  return sessions
}

/** Sessions that still need an archive write. */
export function sessionsToArchive(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => !isArchivedSession(session))
}

function useInvalidateProjectSessions(projectID: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectStats(projectID) })
  }
}

/**
 * Archive every session in a project. The project record itself cannot be
 * archived through the OpenCode API, so this is the closest supported action.
 */
export function useArchiveProjectSessions(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjectSessions(projectID)

  return useMutation({
    mutationFn: async () => {
      const sessions = sessionsToArchive(await listAllProjectSessions(client!, projectID))
      await runWithConcurrency(sessions, PROJECT_ACTION_CONCURRENCY, (session) =>
        client!.session.update({ sessionID: session.id, archived: true })
      )
      return sessions.length
    },
    onSuccess: invalidate,
  })
}

/**
 * Permanently delete every session in a project. Project records have no delete
 * endpoint, so the empty project remains on the server and in Clara.
 */
export function useDeleteProjectSessions(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjectSessions(projectID)

  return useMutation({
    mutationFn: async () => {
      const sessions = await listAllProjectSessions(client!, projectID)
      await runWithConcurrency(sessions, PROJECT_ACTION_CONCURRENCY, (session) =>
        client!.session.remove({ sessionID: session.id })
      )
      return sessions.length
    },
    onSuccess: invalidate,
  })
}
