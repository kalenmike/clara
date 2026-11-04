import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { OpenCodeClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { isMissingDirectoryError } from '@/features/chat/location-recovery'
import { getSessionInfo } from '@/features/sessions/session-cache'
import { isSnoozedSession, unsnoozeMetadata } from '@/features/sessions/session-snooze'
import { readSessionWording } from '@/features/sessions/wording'

/**
 * Clear the server's snooze marker before an action that re-engages the agent.
 * Best effort: the action still runs when the write fails, and the next
 * interaction retries.
 */
export async function unsnoozeSessionOnEngage(
  client: OpenCodeClient,
  queryClient: QueryClient,
  sessionID: string
): Promise<void> {
  try {
    const session = await getSessionInfo(client, queryClient, sessionID)
    if (!isSnoozedSession(session)) return

    const metadata = unsnoozeMetadata(session.metadata)
    await client.session.update({ sessionID, metadata })
    queryClient.setQueryData(queryKeys.session(sessionID), { ...session, metadata })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
  } catch (error) {
    // The message send that follows moves a deleted workspace and retries the
    // write later; warning about the snooze here would be misleading.
    if (isMissingDirectoryError(error)) return
    toast.warning(`The ${readSessionWording().lowerSingular} is still snoozed`)
  }
}
