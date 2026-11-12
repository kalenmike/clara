// Resolve the Clara workspace from an OpenCode plugin or tool context.
//
// OpenCode passes `worktree` and `directory` to tools and plugins. Older
// adapters only knew `workspace` and `location.directory`, so a missing
// context silently fell back to process.cwd(). The environment override wins
// because container deployments mount the workspace at a fixed path.

export interface WorkspaceContext {
  worktree?: unknown
  directory?: unknown
  workspace?: unknown
  location?: { directory?: unknown }
}

function candidate(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function resolveWorkspace(
  context?: WorkspaceContext,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  return (
    candidate(env.CLARA_ORCHESTRATION_WORKSPACE) ??
    candidate(context?.worktree) ??
    candidate(context?.directory) ??
    candidate(context?.workspace) ??
    candidate(context?.location?.directory) ??
    cwd
  )
}

// Older orchestrators require an explicit workspace on start and catalog
// calls. Detect that from the catalog probe instead of letting the model choose
// a workspace; newer services use their own configured workspace.
export function needsExplicitWorkspace(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === 'workspace_required'
}

export function catalogPath(workspace?: string): string {
  return workspace ? `/v1/catalog?workspace=${encodeURIComponent(workspace)}` : '/v1/catalog'
}
