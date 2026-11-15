import { statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { defaultConfigPath } from '@clara/orchestration/loader'
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
 * Resolve the run workspace and the active orchestration config without
 * assuming the service is running. Accepts a workspace directory, a package
 * directory, or a config file. An explicit config file always wins; otherwise
 * the config bundled with the engine is used.
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
    const configured = input.configPath?.trim() || process.env.CLARA_ORCHESTRATION_CONFIG?.trim()
    if (configured) {
      const candidate = resolve(cwd, configured)
      if (!file(candidate)) {
        throw new WorkspaceError('config_missing', `No orchestration config found at ${candidate}.`)
      }
      configPath = candidate
    }
  }

  if (configPath) {
    return { workspace, configPath, configSource: 'file' }
  }

  const fallback = defaultConfigPath()
  if (!fallback) {
    throw new WorkspaceError(
      'config_missing',
      'The bundled orchestration config is missing; rebuild the Lab and engine.'
    )
  }
  return { workspace, configPath: fallback, configSource: 'bundled' }
}
