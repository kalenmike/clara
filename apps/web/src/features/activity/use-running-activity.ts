import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Running sessions across every paired harness. */
export function useRunningActivity() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const running = useQuery({
    queryKey: queryKeys.runningActivity,
    queryFn: () => client!.activity.running(),
    enabled: Boolean(client),
    refetchInterval: 10_000,
  })
  const refresh = useMutation({
    mutationFn: () => client!.activity.running({ refresh: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.runningActivity, data)
    },
  })

  return { ...running, refresh }
}
