import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { main } from '@clara/hub-server/main'
import { assets, buildId } from './embedded-assets.generated'

/**
 * The sidecar is one executable. The panel files are embedded by
 * `scripts/build-sidecar.mjs`; extract them once per build so the existing
 * disk-based panel server can read them.
 */
const cacheRoot = process.env.CLARA_CACHE_DIR?.trim() || join(tmpdir(), 'clara-hub')
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

process.env.CLARA_PANEL_ASSETS_DIR ||= assetsRoot

void main().catch((cause) => {
  const text = cause instanceof Error ? cause.message : String(cause)
  console.error(`[clara] fatal: ${text}`)
  process.exit(1)
})
