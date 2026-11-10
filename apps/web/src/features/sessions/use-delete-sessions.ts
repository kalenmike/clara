import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import type { OpenCodeClient } from '@/lib/client'
import { runWithConcurrencySettled } from '@/lib/concurrency'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type DeleteSessionsResult = {
  deleted: string[]
  failed: Array<{ session: SessionInfo; error: unknown }>
}

export const SESSION_DELETE_CONCURRENCY = 4

/** Delete sessions with four concurrent writes and keep per-session results. */
export async function deleteSessions(
  client: OpenCodeClient,
  sessions: readonly SessionInfo[]
): Promise<DeleteSessionsResult> {
  const settled = await runWithConcurrencySettled(sessions, SESSION_DELETE_CONCURRENCY, (session) =>
    client.session.remove({ sessionID: session.id })
  )

  const deleted: string[] = []
  const failed: DeleteSessionsResult['failed'] = []

  settled.forEach((result) => {
    if (result.status === 'fulfilled') deleted.push(result.item.id)
    else failed.push({ session: result.item, error: result.reason })
  })

  return { deleted, failed }
}

/** Invalidate the list once and each successfully deleted session's query. */
export async function invalidateDeletedSessions(
  queryClient: QueryClient,
  result: DeleteSessionsResult
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  await Promise.all(
    result.deleted.map((sessionID) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    )
  )
}

/** Build a short failure description, naming at most three sessions. */
export function describeFailedSessions(
  failed: DeleteSessionsResult['failed'],
  lowerSingular: string
): string {
  const names = failed.map(({ session }) => {
    const title = session.title?.trim()
    return title || `Untitled ${lowerSingular}`
  })

  const shown = names.slice(0, 3)
  const remaining = names.length - shown.length

  if (shown.length === 0) return ''
  if (remaining > 0) return `${shown.join(', ')} and ${remaining} more`
  if (shown.length === 1) return shown[0]!
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

export type DeleteOutcomeCopy = {
  tone: 'success' | 'error'
  title: string
  description?: string
}

/** Build the result toast copy, or null when nothing was attempted. */
export function describeDeleteOutcome(
  result: DeleteSessionsResult,
  wording: { lowerSingular: string; lowerPlural: string }
): DeleteOutcomeCopy | null {
  const deleted = result.deleted.length
  const failed = result.failed.length
  if (deleted === 0 && failed === 0) return null

  const deletedNoun = deleted === 1 ? wording.lowerSingular : wording.lowerPlural
  const failedNoun = failed === 1 ? wording.lowerSingular : wording.lowerPlural

  if (failed === 0) {
    return { tone: 'success', title: `Deleted ${deleted} ${deletedNoun}` }
  }

  const description = describeFailedSessions(result.failed, wording.lowerSingular)
  const title =
    deleted === 0
      ? `Could not delete ${failed} ${failedNoun}`
      : `Deleted ${deleted} ${deletedNoun} and failed to delete ${failed} ${failedNoun}`

  return description ? { tone: 'error', title, description } : { tone: 'error', title }
}

export function useDeleteSessions() {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sessions: readonly SessionInfo[]) => {
      const result = await deleteSessions(client!, sessions)
      await invalidateDeletedSessions(queryClient, result)
      return result
    },
  })
}
