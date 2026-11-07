import { statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ResolvedWorkspace, PreviewInput } from './types.ts'

export class WorkspaceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
  }
}

function file(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the orchestration config for a workspace without assuming the
 * service is running. Accepts a workspace directory, a package directory, or
 * the index file itself.
 */
export function resolveWorkspace(input: PreviewInput = {}): ResolvedWorkspace {
  const cwd = resolve(input.cwd ?? process.cwd())
  const requested = input.workspace?.trim()
  let workspace = requested ? resolve(cwd, requested) : cwd
  let configPath: string | undefined

  if (file(workspace)) {
    configPath = workspace
    const parent = dirname(workspace)
    workspace = basename(parent) === 'orchestration' ? dirname(parent) : parent
  }

  if (!configPath) {
    for (const candidate of [
      join(workspace, 'orchestration', 'index.yml'),
      join(workspace, 'orchestration', 'index.yaml'),
      join(workspace, 'index.yml'),
      join(workspace, 'index.yaml'),
    ]) {
      if (file(candidate)) {
        configPath = candidate
        break
      }
    }
  }

  if (!configPath) {
    const configured = input.configPath?.trim() || process.env.CLARA_ORCHESTRATION_CONFIG?.trim()
    if (configured) {
      const candidate = resolve(cwd, configured)
      if (!file(candidate)) {
        throw new WorkspaceError('config_missing', `No orchestration config found at ${candidate}.`)
      }
      configPath = candidate
    }
  }

  if (!configPath) {
    throw new WorkspaceError(
      'config_missing',
      `No orchestration config found for ${workspace}. Expected orchestration/index.yml or index.yml.`
    )
  }

  const stdDir = input.stdDir?.trim() || process.env.CLARA_STD_DIR?.trim()
  return {
    workspace,
    configPath,
    ...(stdDir ? { stdDir: resolve(cwd, stdDir) } : {}),
  }
}
