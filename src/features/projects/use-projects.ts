import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useProjects() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => client!.project.list(),
    enabled: Boolean(client),
    staleTime: 30_000,
  })
}
