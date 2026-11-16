import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readAdapterRecords } from '../adapters/state.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

/**
 * A hub host owns the Clara services. An adapter host only reaches the hub
 * through a paired adapter, so its service commands are read-only.
 */
export type ClaraRole = 'hub' | 'adapter' | 'unconfigured'

export type RoleInput = {
  hasHubConfig: boolean
  hasStackState: boolean
  pairedAdapters: number
}

export function resolveRole(input: RoleInput): ClaraRole {
  if (input.hasHubConfig || input.hasStackState) return 'hub'
  if (input.pairedAdapters > 0) return 'adapter'
  return 'unconfigured'
}

export function detectRole(paths: ClaraPaths = resolvePaths()): ClaraRole {
  const state = readAdapterRecords(paths)
  return resolveRole({
    hasHubConfig: existsSync(join(paths.configDir, 'server.json')),
    hasStackState: existsSync(paths.stateFile),
    pairedAdapters: Object.values(state.adapters).filter((record) => record?.pairedAt).length,
  })
}

export function roleLabel(role: ClaraRole): string {
  return role === 'hub' ? 'hub host' : role === 'adapter' ? 'adapter host' : 'unconfigured'
}
