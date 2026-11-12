import { ApiRequestError, type ApiDependencies } from './context.ts'
import { forwardDto, parseClaraProjects } from './dto.ts'

/**
 * Resolve a Clara project to every harness project record it owns. OpenCode can
 * keep more than one record for the same canonical directory (for example
 * before and after `git init`), and a project's sessions may live in any of
 * them, so callers must query all of them instead of picking one.
 *
 * When the link table has no entry yet, refresh the harness project list once
 * to rebuild the links, then retry. This keeps a stale hub database from
 * turning a project into an empty session list.
 */
export async function resolveHarnessProjectIds(
  deps: ApiDependencies,
  projectId: string,
  signal: AbortSignal
): Promise<string[]> {
  const direct = deps.harness.harnessProjectIds(projectId)
  if (direct.length > 0) return direct

  const projects = await forwardDto(
    deps,
    { method: 'GET', path: '/projects' },
    signal,
    parseClaraProjects
  )
  deps.harness.overlayProjectList(projects)
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
    'This project is not linked to the active harness adapter. Refresh projects and try again.',
    { projectID: projectId }
  )
}
