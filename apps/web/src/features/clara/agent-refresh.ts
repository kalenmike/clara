import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/**
 * The home agent rewrites the agent files and reloads OpenCode before it
 * broadcasts the new management flag. Refresh the catalog so Clara appears or
 * disappears from the agent picker without a page reload.
 */
export function useClaraAgentRefresh() {
  const { relayStatus } = useConnection()
  const queryClient = useQueryClient()
  const management = relayStatus?.agent?.management
  const previous = useRef(management)

  useEffect(() => {
    if (previous.current === management) return
    previous.current = management
    void queryClient.invalidateQueries({ queryKey: queryKeys.agents })
  }, [management, queryClient])
}
