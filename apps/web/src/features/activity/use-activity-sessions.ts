import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Inbox and Outbox sessions across every paired harness. */
export function useActivitySessions() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const activity = useQuery({
    queryKey: queryKeys.activitySessions,
    queryFn: () => client!.activity.sessions(),
    enabled: Boolean(client),
    refetchInterval: 10_000,
  })
  const refresh = useMutation({
    mutationFn: () => client!.activity.sessions({ refresh: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.activitySessions, data)
    },
  })

  return { ...activity, refresh }
}
