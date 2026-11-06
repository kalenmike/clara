import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/**
 * Reads the home agent's effective pipeline catalog. The tab is only mounted
 * when the control channel exists, so direct OpenCode connections never call
 * this hook.
 */
export function usePipelines() {
  const { control } = useConnection()
  return useQuery({
    queryKey: queryKeys.pipelines,
    queryFn: () => control!.listPipelines(),
    enabled: Boolean(control),
    staleTime: 30_000,
  })
}
