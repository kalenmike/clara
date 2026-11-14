import { useQueries } from '@tanstack/react-query'
import type { ClaraSessionsHarnessStatus } from '@clara/api-contract'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type ProjectPresenceAnswer = {
  hasSessions: boolean
  harnesses: ReadonlyArray<ClaraSessionsHarnessStatus>
}

export type PresenceQueryResult = {
  data?: ProjectPresenceAnswer
  isError: boolean
  isPending: boolean
}

export type ProjectPresence = {
  hasSessions: Map<string, boolean>
  /** Projects with at least one linked harness that failed or was offline. */
  incomplete: Set<string>
  pending: boolean
  /** True only when no project lookup answered, so partials never look fatal. */
  failed: boolean
}

/**
 * Combine one lookup per project. A lookup that answered with some harnesses
 * down still counts as answered: it is incomplete, not failed, and keeps the
 * project visible instead of implying it is empty.
 */
export function combineProjectPresence(
  projectIDs: string[],
  results: ReadonlyArray<PresenceQueryResult>
): ProjectPresence {
  const hasSessions = new Map<string, boolean>()
  const incomplete = new Set<string>()
  results.forEach((result, index) => {
    if (result.data === undefined) return
    const projectID = projectIDs[index]
    hasSessions.set(projectID, result.data.hasSessions)
    if (result.data.harnesses.some((harness) => !harness.ok)) incomplete.add(projectID)
  })
  const answered = results.some((result) => result.data !== undefined)
  return {
    hasSessions,
    incomplete,
    pending: results.some((result) => result.isPending),
    failed: results.length > 0 && !answered && results.every((result) => result.isError),
  }
}

/**
 * Whether each project has at least one session. A limit of one keeps the
 * lookup cheap enough to run for every project in the switcher.
 */
export function useProjectSessionPresence(projectIDs: string[], enabled = true) {
  const { client } = useConnection()

  return useQueries({
    queries: projectIDs.map((projectID) => ({
      queryKey: queryKeys.projectPresence(projectID),
      queryFn: async (): Promise<ProjectPresenceAnswer> => {
        const response = await client!.session.list({ project: projectID, limit: 1 })
        return { hasSessions: response.data.length > 0, harnesses: response.harnesses ?? [] }
      },
      enabled: Boolean(client) && enabled,
      staleTime: 30_000,
      retry: 1,
    })),
    combine: (results) => combineProjectPresence(projectIDs, results),
  })
}
