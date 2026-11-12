import { ApiRequestError, type ApiDependencies } from './context.ts'
import { syncProject } from './project-service.ts'

/**
 * Resolve a Clara project to every harness project record the active harness
 * owns. OpenCode can keep more than one record for the same directory (for
 * example before and after `git init`), and a project's sessions may live in
 * any of them, so callers must query all of them instead of picking one.
 *
 * When the project has no workspace on the active harness, sync its workspaces
 * once and retry. This keeps a newly paired harness from looking empty without
 * ever inventing a Clara project from a harness list.
 */
export async function resolveHarnessProjectIds(
  deps: ApiDependencies,
  projectId: string,
  signal: AbortSignal
): Promise<string[]> {
  const direct = deps.harness.harnessProjectIds(projectId)
  if (direct.length > 0) return direct

  const record = deps.harness.projects.get(projectId)
  if (!record) throw unmappedProjectError(projectId)
  await syncProject(deps, projectId, signal).catch(() => undefined)
  return deps.harness.harnessProjectIds(projectId)
}

/**
 * A Clara project id must never reach the harness. If no harness record owns
 * it, say so instead of forwarding an id the harness cannot match, which would
 * look like an empty project.
 */
export function unmappedProjectError(projectId: string): ApiRequestError {
  return new ApiRequestError(
    409,
    'project_unmapped',
    'This project is not linked to a workspace on the active harness.',
    { projectID: projectId }
  )
}
