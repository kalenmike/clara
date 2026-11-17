// Resolve the Clara workspace from an OpenCode plugin or tool context.
//
// OpenCode passes `worktree` and `directory` to tools and plugins. Older
// adapters only knew `workspace` and `location.directory`, so a missing
// context silently fell back to process.cwd(). The environment override wins
// because container deployments mount the workspace at a fixed path.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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
    candidate(env.CLARA_ENGINE_WORKSPACE) ??
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

/**
 * The engine and the adapter can mount the same workspace at different paths.
 * A work order carries the engine's path unless it is a wrapper worktree; use
 * the requested path when it exists here, otherwise the adapter workspace.
 */
export function localWorkspacePath(requested: unknown, current: string): string {
  const value = typeof requested === 'string' ? requested.trim() : ''
  if (value && existsSync(value)) return value
  return current
}

export interface WorkspaceRun {
  origin_workspace?: string | null
  workspace?: string | null
}

/** Whether a run belongs to the workspace this adapter serves. */
export function ownsWorkspace(run: WorkspaceRun, current: string): boolean {
  const target = resolve(current)
  const execution = typeof run.origin_workspace === 'string' ? run.origin_workspace.trim() : ''
  if (execution) {
    return execution === current || resolve(execution) === target || !existsSync(execution)
  }
  const workspace = typeof run.workspace === 'string' ? run.workspace.trim() : ''
  if (!workspace) return true
  return workspace === current || resolve(workspace) === target || !existsSync(workspace)
}
