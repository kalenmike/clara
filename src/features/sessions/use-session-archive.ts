import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import { appendDoneSuffix } from '@/features/sessions/session-archive'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** Mark a session done: append the title suffix and archive it on the server. */
export function useDoneSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ session, empty }: { session: SessionInfo; empty: boolean }) =>
      empty
        ? client!.session.remove({ sessionID: session.id })
        : client!.session.update({
            sessionID: session.id,
            title: appendDoneSuffix(session.title),
            archived: true,
          }),
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
