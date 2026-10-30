import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function usePendingPermissions(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: [...queryKeys.permissions, directory ?? 'global'],
    queryFn: () => client!.permission.request.list({ location: { directory } }),
    enabled: Boolean(client),
    select: (result) => result.data,
    refetchInterval: 15_000,
  })
}

export function useReplyPermission() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      sessionID: string
      requestID: string
      decision: 'once' | 'always' | 'reject'
      message?: string
    }) => client!.permission.reply(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissions })
    },
  })
}
