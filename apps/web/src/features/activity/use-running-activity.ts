import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Running sessions across every paired harness. */
export function useRunningActivity() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.runningActivity,
    queryFn: () => client!.activity.running(),
    enabled: Boolean(client),
    refetchInterval: 10_000,
  })
}
