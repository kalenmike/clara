import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Inbox and Outbox sessions for one project across its workspaces and harnesses. */
export function useActivitySessions(projectID: string | null) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.activityProjectSessions(projectID)
  const activity = useQuery({
    queryKey,
    queryFn: () => client!.activity.sessions({ project: projectID! }),
    enabled: Boolean(client) && Boolean(projectID),
    refetchInterval: 10_000,
  })
  const refresh = useMutation({
    mutationFn: () => client!.activity.sessions({ project: projectID!, refresh: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })

  return { ...activity, refresh }
}
