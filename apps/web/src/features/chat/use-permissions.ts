import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unsnoozeSessionOnEngage } from '@/features/sessions/unsnooze'
import { harnessLocation, useHarnessScope } from '@/features/harness/harness-scope'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function usePendingPermissions(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.permissionsFor(directory, target),
    queryFn: () => client!.permission.request.list(harnessLocation(directory, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    refetchInterval: 15_000,
  })
}

export function useReplyPermission() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      sessionID: string
      requestID: string
      decision: 'once' | 'always' | 'reject'
      message?: string
    }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, input.sessionID)
      return client!.permission.reply(input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissions })
    },
  })
}
