import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ClaraSession } from '@clara/api-contract'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Mark a session done by archiving it on the server without renaming it. */
export function useDoneSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ session, empty }: { session: ClaraSession; empty: boolean }) =>
      empty
        ? client!.session.remove({ sessionID: session.id })
        : client!.session.update({ sessionID: session.id, archived: true }),
    onSuccess: (_result, { session, empty }) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (empty) {
        queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
        queryClient.removeQueries({ queryKey: queryKeys.messages(session.id) })
        queryClient.removeQueries({ queryKey: queryKeys.sessionMailbox(session.id) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
      }
    },
  })
}
