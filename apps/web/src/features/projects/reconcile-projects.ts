import type { Project } from '@opencode/client'
import { runWithConcurrency } from '@/lib/concurrency'
import type { OpenCodeClient } from '@/lib/client'

/** Keep a large archive list from flooding the server with directory probes. */
export const PROJECT_RECONCILIATION_CONCURRENCY = 3
/** A probe resolves a directory and may run Git discovery; never let one hang a pass. */
export const PROJECT_RECONCILIATION_TIMEOUT_MS = 5_000

export type ProjectReconciliation = {
  archived: number
  restored: string[]
}

function isArchivedProject(project: Project): boolean {
  return project.time.archived != null
}

/**
 * OpenCode archives a project when none of its known directories exist, and
 * unarchives it when a directory-scoped request resolves one of them again.
 * Probing `location.get` therefore restores every project whose volume is
 * mounted, while missing directories reject with 404 and stay archived.
 */
export async function reconcileArchivedProjects(
  client: OpenCodeClient
): Promise<ProjectReconciliation> {
  const projects = await client.project.list(
    { archived: true },
    { signal: AbortSignal.timeout(PROJECT_RECONCILIATION_TIMEOUT_MS) }
  )
  const archived = projects.filter(isArchivedProject)
  if (archived.length === 0) return { archived: 0, restored: [] }

  const restored: string[] = []
  await runWithConcurrency(archived, PROJECT_RECONCILIATION_CONCURRENCY, async (project) => {
    try {
      await client.location.get(
        { location: { directory: project.canonical } },
        { signal: AbortSignal.timeout(PROJECT_RECONCILIATION_TIMEOUT_MS) }
      )
      restored.push(project.id)
    } catch {
      // A missing directory rejects with LocationNotFoundError. Keep it archived.
    }
  })

  return { archived: archived.length, restored }
}
