import { useQueries } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type PresenceQueryResult = {
  data?: boolean
  isError: boolean
  isPending: boolean
}

export type ProjectPresence = {
  hasSessions: Map<string, boolean>
  pending: boolean
  failed: boolean
}

/**
 * Combine one lookup per project. A failure is reported instead of being
 * treated as "unknown", so the UI can say that counts are unavailable rather
 * than implying every project is empty.
 */
export function combineProjectPresence(
  projectIDs: string[],
  results: ReadonlyArray<PresenceQueryResult>
): ProjectPresence {
  const hasSessions = new Map<string, boolean>()
  let failed = false
  results.forEach((result, index) => {
    if (result.data !== undefined) hasSessions.set(projectIDs[index], result.data)
    else if (result.isError) failed = true
  })
  return {
    hasSessions,
    pending: results.some((result) => result.isPending),
    failed,
  }
}

/**
 * Whether each project has at least one session. A limit of one keeps the
 * lookup cheap enough to run for every project in the switcher.
 */
export function useProjectSessionPresence(projectIDs: string[], enabled = true) {
  const { client } = useConnection()

  return useQueries({
    queries: projectIDs.map((projectID) => ({
      queryKey: queryKeys.projectPresence(projectID),
      queryFn: async () => {
        const response = await client!.session.list({ project: projectID, limit: 1 })
        return response.data.length > 0
      },
      enabled: Boolean(client) && enabled,
      staleTime: 30_000,
      retry: 1,
    })),
    combine: (results) => combineProjectPresence(projectIDs, results),
  })
}
