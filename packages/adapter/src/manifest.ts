import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HarnessName } from './args.ts'

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

export interface HarnessManifest {
  pluginPath: string
  agentPath: string
  configPath: string
  mcp: boolean
  installedAt: number
}

export interface InstallManifest {
  version: 1
  updatedAt: number
  harnesses: Partial<Record<HarnessName, HarnessManifest>>
  runner?: RunnerManifest
}

export function claraConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara')
}

export function manifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraConfigDir(env), 'adapter.json')
}

export function emptyManifest(): InstallManifest {
  return { version: 1, updatedAt: Date.now(), harnesses: {} }
}

export function readManifest(path = manifestPath()): InstallManifest {
  if (!existsSync(path)) return emptyManifest()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<InstallManifest>
    if (parsed.version !== 1 || !parsed.harnesses || typeof parsed.harnesses !== 'object') {
      return emptyManifest()
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      harnesses: parsed.harnesses,
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
