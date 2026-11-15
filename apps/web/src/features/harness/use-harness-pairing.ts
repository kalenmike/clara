import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ClaraHarnessPairingRequest, ClaraHarnessPairingResponse } from '@clara/api-contract'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/**
 * Ask the hub for a one-time adapter pairing and its install command. The hub
 * never runs the install; the desktop client or the person does.
 */
export function useCreateHarnessPairing() {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation<ClaraHarnessPairingResponse, Error, ClaraHarnessPairingRequest>({
    mutationFn: (input) => client!.harness.pairing.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.harnesses })
    },
  })
}
