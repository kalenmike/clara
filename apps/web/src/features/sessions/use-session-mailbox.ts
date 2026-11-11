import { useQueries } from '@tanstack/react-query'
import type { ClaraSession } from '@clara/api-contract'
import { loadSessionMailboxSignals } from '@/features/sessions/session-mailbox-signals'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/**
 * Collect the signals that decide a session's mailbox: the author of the latest
 * conversational message and whether the agent is waiting on a form answer.
 *
 * The server's newest message is often an internal `idle` note, so the latest
 * user and assistant messages are fetched separately. Running state and pending
 * permissions come from their own queries, so a form lookup failure still
 * leaves the message signals intact.
 */
export function useSessionMailboxSignals(sessions: ClaraSession[]) {
  const { client } = useConnection()

  return useQueries({
    queries: sessions.map((session) => ({
      queryKey: queryKeys.sessionMailbox(session.id),
      queryFn: ({ signal }) => loadSessionMailboxSignals(client!, session.id, signal),
      enabled: Boolean(client),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
    combine: (results) => ({
      signals: new Map(
        sessions.flatMap((session, index) => {
          const signals = results[index]?.data
          return signals ? [[session.id, signals] as const] : []
        })
      ),
      pending: results.some((result) => result.isPending),
    }),
  })
}
