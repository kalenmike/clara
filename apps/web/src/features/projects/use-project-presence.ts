import { useQueries } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

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
    combine: (results) => {
      const hasSessions = new Map<string, boolean>()
      results.forEach((result, index) => {
        if (result.data !== undefined) hasSessions.set(projectIDs[index], result.data)
      })
      return {
        hasSessions,
        pending: results.some((result) => result.isPending),
      }
    },
  })
}
