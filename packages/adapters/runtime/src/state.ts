import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AdapterLiveState } from './types.ts'

export function readState(path: string): AdapterLiveState | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterLiveState>
    const harness = value.harness
    if (
      typeof value.pid !== 'number' ||
      typeof value.updatedAt !== 'number' ||
      !value.hub ||
      typeof value.hub.url !== 'string' ||
      !harness ||
      typeof harness.url !== 'string'
    ) {
      return undefined
    }
    return { ...(value as AdapterLiveState), harness }
  } catch {
    return undefined
  }
}

/** Atomic write so a status read never sees a half-written snapshot. */
export function writeState(path: string, state: AdapterLiveState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function removeState(path: string): void {
  rmSync(path, { force: true })
}
