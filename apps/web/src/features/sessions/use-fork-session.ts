import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SessionInfo } from '@opencode/client'
import { toast } from 'sonner'
import type { MessageFork } from '@/features/sessions/fork'
import { isSnoozedSession, unsnoozeMetadata } from '@/features/sessions/session-snooze'
import { useSessionWording } from '@/features/sessions/use-wording'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

type SessionTarget = {
  session: SessionInfo | undefined
  projectID: string | undefined
}

/** Create a child session from the whole transcript or from a message boundary. */
export function useForkSession({ session, projectID }: SessionTarget) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { lowerSingular } = useSessionWording()

  return useMutation({
    mutationFn: async (input: MessageFork = {}) => {
      if (!session || !client) throw new Error('No session to fork')
      const forked = await client.session.fork({
        sessionID: session.id,
        ...(input.before ? { before: input.before } : {}),
      })

      // The server copies parent metadata, including the snooze marker. A new
      // branch should be visible in the mailbox immediately.
      if (isSnoozedSession(forked)) {
        const metadata = unsnoozeMetadata(forked.metadata)
        try {
          await client.session.update({ sessionID: forked.id, metadata })
          return { ...forked, metadata }
        } catch {
          // Keep the branch usable even when the cleanup call fails.
        }
      }

      return forked
    },
    onSuccess: (forked) => {
      queryClient.setQueryData(queryKeys.session(forked.id), forked)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(forked.id) })

      const targetProject = projectID ?? session?.projectID
      if (targetProject) navigate(`/p/${targetProject}/s/${forked.id}`)
    },
    onError: () => {
      toast.error(`Could not fork the ${lowerSingular}`)
    },
  })
}
