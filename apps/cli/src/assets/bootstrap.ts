import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { resolvePaths } from '../paths.ts'

/**
 * The packaged binary carries the hub panel, the web client, and the engine's
 * standard packages and default config as embedded files. The build writes the
 * manifest; a source checkout has none, so each service keeps its source
 * fallback.
 */
export type EmbeddedAssets = {
  assets: Record<string, string>
  buildId: string
}

let pending: Promise<void> | undefined

/** Extract the embedded files once per build and point the services at them. */
export function bootstrapEmbedded(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  pending ??= extractEmbedded(env)
  return pending
}

async function extractEmbedded(env: NodeJS.ProcessEnv): Promise<void> {
  const embedded = await loadManifest()
  if (!embedded || Object.keys(embedded.assets).length === 0) return
  extractEmbeddedAssets(embedded, env)
}

/**
 * Write the embedded files below the cache directory and point the services at
 * their own subtree. A `.complete` marker makes a second process skip the work.
 */
export function extractEmbeddedAssets(
  embedded: EmbeddedAssets,
  env: NodeJS.ProcessEnv = process.env
): string {
  const assetsRoot = join(resolvePaths(env).cacheDir, 'assets', embedded.buildId)
  if (!existsSync(join(assetsRoot, '.complete'))) {
    rmSync(assetsRoot, { recursive: true, force: true })
    for (const [name, source] of Object.entries(embedded.assets)) {
      const target = join(assetsRoot, safeRelative(name))
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(target, readFileSync(source), { mode: 0o600 })
    }
    writeFileSync(join(assetsRoot, '.complete'), '1', { mode: 0o600 })
  }

  env.CLARA_PANEL_ASSETS_DIR ||= join(assetsRoot, 'panel')
  env.CLARA_WEB_ASSETS_DIR ||= join(assetsRoot, 'web')
  env.CLARA_ENGINE_ASSETS_DIR ||= join(assetsRoot, 'engine')
  return assetsRoot
}

async function loadManifest(): Promise<EmbeddedAssets | undefined> {
  // Only Bun evaluates the generated `with { type: 'file' }` imports. A source
  // checkout on Node keeps its source fallbacks even after a package build.
  if (!(globalThis as { Bun?: unknown }).Bun) return undefined
  try {
    return (await import('../embedded-assets.generated.mjs')) as EmbeddedAssets
  } catch (cause) {
    if (missingModule(cause)) return undefined
    throw cause
  }
}

/** A source checkout has no generated manifest; only that case is tolerated. */
function missingModule(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  const code = (cause as { code?: unknown }).code
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true
  return /cannot find module/i.test(cause.message)
}

/** Every name comes from our own build, but never trust it with a cache path. */
function safeRelative(name: string): string {
  const parts = name.split(/[\\/]/)
  const unsafe =
    !name ||
    isAbsolute(name) ||
    /^[a-zA-Z]:/.test(name) ||
    parts.some((part) => !part || part === '.' || part === '..')
  if (unsafe) throw new Error(`Refusing to extract an unsafe embedded asset path: ${name}`)
  return join(...parts)
}
