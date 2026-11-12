import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { claraConfigDir } from './config.ts'

export interface RunnerManifest {
  url: string
  workspace: string
  concurrency: number
  labels: string[]
  service: 'systemd' | 'launchd' | 'none'
  unitPath?: string
  /** True when the runner was requested without a harness install. */
  explicit: boolean
  installedAt: number
}

/** The one shared runner install. Harness adapters keep their own config. */
export interface InstallManifest {
  version: 1
  updatedAt: number
  runner?: RunnerManifest
}

export function manifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraConfigDir(env), 'adapter.json')
}

export function emptyManifest(): InstallManifest {
  return { version: 1, updatedAt: Date.now() }
}

export function readManifest(path = manifestPath()): InstallManifest {
  if (!existsSync(path)) return emptyManifest()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<InstallManifest>
    if (parsed.version !== 1) return emptyManifest()
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      ...(parsed.runner ? { runner: parsed.runner } : {}),
    }
  } catch {
    return emptyManifest()
  }
}

export function writeManifest(path: string, manifest: InstallManifest): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const next = { ...manifest, updatedAt: Date.now() }
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
