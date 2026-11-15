import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { assets, buildId } from './embedded-assets.generated'

/**
 * The Bun executable carries the engine's standard packages and default config
 * as embedded files. Extract them once per build, point the loader at the copy,
 * then run the CLI unchanged.
 */
const cacheRoot = process.env.CLARA_CACHE_DIR?.trim() || join(tmpdir(), 'clara-engine')
const assetsRoot = join(cacheRoot, 'assets', buildId)
const marker = join(assetsRoot, '.complete')

if (!existsSync(marker)) {
  rmSync(assetsRoot, { recursive: true, force: true })
  for (const [name, source] of Object.entries(assets)) {
    if (name.startsWith('..') || isAbsolute(name)) {
      throw new Error(`Refusing to extract an unsafe embedded asset path: ${name}`)
    }
    const target = join(assetsRoot, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(source))
  }
  writeFileSync(marker, '1')
}

process.env.CLARA_ENGINE_ASSETS_DIR ||= assetsRoot

const { serveEngine } = await import('./serve.ts')

await serveEngine().catch((cause) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  console.error(`[clara-engine] fatal: ${text}`)
  process.exit(1)
})
