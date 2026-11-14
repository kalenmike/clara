import type { ApiDependencies } from './context.ts'
import { ApiRequestError } from './context.ts'
import { syncProject } from './project-service.ts'

export type HarnessProjectGroup = {
  harnessID: string
  projectIDs: string[]
}

/** Require an explicitly requested harness to still be paired. */
export function requireHarness(deps: ApiDependencies, harnessID: string): string {
  if (!deps.harness.connection(harnessID)) {
    throw new ApiRequestError(404, 'harness_missing', 'That harness is no longer paired')
  }
  return harnessID
}

/**
 * Resolve the harness that owns a session. Every session read by the hub is
 * recorded in `clara_sessions`, so the normal path is a single indexed lookup.
 * The active harness remains the fallback for a session opened before the hub
 * ever listed it.
 */
export function resolveHarnessForSession(
  deps: ApiDependencies,
  sessionID: string
): string | undefined {
  return deps.harness.metadata.harnessIdForSession(sessionID) ?? deps.harness.active?.harnessId
}

/**
 * Resolve a directory-scoped request. An explicit harness wins, then a unique
 * workspace match, then the active harness when it is one of several matches.
 * Ambiguity is an error instead of a guess: the same path can exist on two
 * machines.
 */
export function resolveHarnessForDirectory(
  deps: ApiDependencies,
  directory: string | undefined,
  explicitHarnessID?: string
): string | undefined {
  if (explicitHarnessID) return requireHarness(deps, explicitHarnessID)
  if (!directory) return deps.harness.active?.harnessId

  const harnessIDs = [
    ...new Set(
      deps.harness.projects
        .workspacesForDirectory(directory)
        .map((workspace) => workspace.harnessID)
    ),
  ]
  if (harnessIDs.length === 1) return harnessIDs[0]

  const active = deps.harness.active?.harnessId
  const online = harnessIDs.filter((harnessID) => deps.harness.connection(harnessID)?.online)
  // Prefer the only reachable match over a stale default on an offline machine.
  if (online.length === 1) return online[0]
  if (active && online.includes(active)) return active
  if (active && harnessIDs.includes(active)) return active
  if (harnessIDs.length > 1) {
    throw new ApiRequestError(
      409,
      'harness_ambiguous',
      'That directory exists on more than one harness. Choose a harness.',
      { harnessIDs }
    )
  }
  return active
}

/**
 * Every harness project record linked to a Clara project, grouped by harness.
 * If nothing is linked yet, resolve the project's workspaces once and retry so
 * a newly paired harness does not look empty.
 */
export async function resolveHarnessProjectGroups(
  deps: ApiDependencies,
  projectID: string,
  signal: AbortSignal
): Promise<HarnessProjectGroup[]> {
  const direct = projectGroups(deps, projectID)
  if (direct.length > 0) return direct
  if (!deps.harness.projects.get(projectID)) return []
  await syncProject(deps, projectID, signal).catch(() => undefined)
  return projectGroups(deps, projectID)
}

function projectGroups(deps: ApiDependencies, projectID: string): HarnessProjectGroup[] {
  const groups = new Map<string, string[]>()
  for (const link of deps.harness.projects.linksForProject(projectID)) {
    const current = groups.get(link.harness_id) ?? []
    if (!current.includes(link.harness_project_id)) current.push(link.harness_project_id)
    groups.set(link.harness_id, current)
  }
  return [...groups].map(([harnessID, projectIDs]) => ({ harnessID, projectIDs }))
}

/** A stable key for the hub-owned multi-record session cursor. */
export function sessionPageKey(harnessID: string, projectID: string): string {
  return `${harnessID}:${projectID}`
}
