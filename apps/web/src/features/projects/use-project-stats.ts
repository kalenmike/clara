import { useQuery } from '@tanstack/react-query'
import { PROJECT_STATS_LIMIT, summarizeProjectSessions } from '@/features/projects/project-stats'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/**
 * Session totals for one project. The server returns archived and
 * non-archived sessions when `archived` is omitted, so one request is enough.
 * Projects that span harnesses also carry per-harness statuses so partial
 * answers stay distinguishable from complete ones.
 */
export function useProjectStats(projectID: string | null, enabled = true) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.projectStats(projectID),
    queryFn: async () => {
      const response = await client!.session.list({
        project: projectID ?? undefined,
        limit: PROJECT_STATS_LIMIT,
      })
      return summarizeProjectSessions(response.data, response.harnesses ?? [])
    },
    enabled: Boolean(client) && Boolean(projectID) && enabled,
    staleTime: 30_000,
  })
}
