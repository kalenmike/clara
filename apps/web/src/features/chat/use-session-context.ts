import { useQuery } from '@tanstack/react-query'
import { useConnection } from '@/providers/connection-provider'

export function useSessionContext(sessionID: string, enabled = true) {
  const { client } = useConnection()
  return useQuery({
    queryKey: ['context', sessionID],
    queryFn: () => client!.session.context({ sessionID }),
    enabled: Boolean(client && sessionID && enabled),
    staleTime: 5_000,
  })
}
