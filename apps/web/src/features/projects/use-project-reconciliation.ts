import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'
import { reconcileArchivedProjects } from './reconcile-projects'

/**
 * Restore archived projects whose directories are available again. The harness
 * archives a project when its directory disappears and unarchives it when a
 * directory-scoped request resolves it, so one probe per archived project is
 * enough. Missing directories stay archived.
 */
export function useProjectReconciliation() {
  const { client, generation, status } = useConnection()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.projectReconciliation(generation),
    queryFn: async () => {
      const result = await reconcileArchivedProjects(client!)
      if (result.restored.length > 0) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      }
      return result
    },
    enabled: Boolean(client) && status === 'connected',
    // One pass per connection generation; a manual refresh calls refetch.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    reconcile: () => query.refetch(),
    pending: query.isFetching,
  }
}
