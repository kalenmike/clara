import type { ClaraProjectWorkspace, ClaraSession } from '@clara/api-contract'

/**
 * A session belongs to the workspace the hub resolved, so the workspace ID is
 * authoritative. Older payloads can omit it; fall back to the linked harness
 * and directory in that case.
 */
function belongsToWorkspace(session: ClaraSession, workspace: ClaraProjectWorkspace): boolean {
  if (session.harnessID && session.harnessID !== workspace.harnessID) return false
  if (session.workspaceID) return session.workspaceID === workspace.id

  const directory = session.location.directory
  return directory === workspace.directory || directory === workspace.canonical
}

/**
 * The newest session that ran in one harness/workspace pair. A new brief uses
 * its model as the saved default, so a session from another harness or machine
 * can never leak a model into this workspace.
 */
export function latestSessionInWorkspace(
  sessions: readonly ClaraSession[],
  workspace: ClaraProjectWorkspace | null | undefined
): ClaraSession | undefined {
  if (!workspace) return undefined

  let latest: ClaraSession | undefined
  for (const session of sessions) {
    if (!belongsToWorkspace(session, workspace)) continue
    if (!latest || session.time.updated > latest.time.updated) latest = session
  }
  return latest
}
