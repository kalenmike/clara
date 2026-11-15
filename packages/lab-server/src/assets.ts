import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export type EngineAssets = {
  hash: string
  dir: string
  version?: string
}

type Bundle = {
  version?: unknown
  hash?: unknown
  files?: unknown
}

function cacheRoot(): string {
  const configured = process.env.CLARA_CACHE_DIR?.trim()
  if (configured) return join(configured, 'lab', 'assets')
  const xdg = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache')
  return join(xdg, 'clara', 'lab', 'assets')
}

function safeRelative(name: string): boolean {
  if (!name || isAbsolute(name) || name.includes('\\') || name.includes('\0')) return false
  return !name.split('/').some((segment) => segment === '..' || segment === '')
}

function cached(hash: string): EngineAssets | undefined {
  if (!/^[a-f0-9]{8,64}$/i.test(hash)) return undefined
  const dir = join(cacheRoot(), hash)
  if (existsSync(join(dir, 'std')) && existsSync(join(dir, 'default', 'index.yml'))) {
    return { hash, dir }
  }
  return undefined
}

/**
 * Fetch the engine's std/default bundle and materialize it for the preview
 * loader. The engine is the source of truth, so a preview never compiles
 * against a stale copy bundled with the lab.
 */
export async function fetchEngineAssets(options: {
  url: string
  token: string
  signal?: AbortSignal
}): Promise<EngineAssets | undefined> {
  if (!options.token) return undefined
  let response: Response
  try {
    response = await fetch(`${options.url.replace(/\/$/, '')}/v1/packages/assets`, {
      headers: { authorization: `Bearer ${options.token}` },
      ...(options.signal ? { signal: options.signal } : {}),
      cache: 'no-store',
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined

  let bundle: Bundle
  try {
    bundle = (await response.json()) as Bundle
  } catch {
    return undefined
  }
  const hash = typeof bundle.hash === 'string' ? bundle.hash : ''
  const files = bundle.files
  if (!/^[a-f0-9]{8,64}$/i.test(hash) || typeof files !== 'object' || files === null) {
    return undefined
  }

  const existing = cached(hash)
  if (existing) return existing

  const root = cacheRoot()
  const target = join(root, hash)
  const temporary = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    rmSync(temporary, { recursive: true, force: true })
    for (const [name, value] of Object.entries(files as Record<string, unknown>)) {
      if (!safeRelative(name) || typeof value !== 'string') continue
      const file = resolve(temporary, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, value)
    }
    if (!existsSync(join(temporary, 'default', 'index.yml'))) {
      rmSync(temporary, { recursive: true, force: true })
      return undefined
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(temporary, target)
  } catch {
    rmSync(temporary, { recursive: true, force: true })
    return undefined
  }

  return {
    hash,
    dir: target,
    ...(typeof bundle.version === 'string' ? { version: bundle.version } : {}),
  }
}

/** Point the preview loader at the fetched bundle for this process. */
export function useEngineAssets(assets: EngineAssets): void {
  process.env.CLARA_ENGINE_ASSETS_DIR = assets.dir
}

/** Read one cached file, used by tests and diagnostics. */
export function readCachedAsset(assets: EngineAssets, name: string): string | undefined {
  if (!safeRelative(name)) return undefined
  try {
    return readFileSync(join(assets.dir, name), 'utf8')
  } catch {
    return undefined
  }
}
