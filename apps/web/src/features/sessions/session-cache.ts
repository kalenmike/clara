import type { QueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import type { ClaraClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'

/** Read a session from the query cache, fetching it once when the page has not. */
export async function getSessionInfo(
  client: ClaraClient,
  queryClient: QueryClient,
  sessionID: string
): Promise<SessionInfo> {
  const cached = queryClient.getQueryData<SessionInfo>(queryKeys.session(sessionID))
  if (cached) return cached

  const session = await client.session.get({ sessionID })
  queryClient.setQueryData(queryKeys.session(sessionID), session)
  return session
}
