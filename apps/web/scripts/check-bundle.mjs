import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureEnabled } from '../../../tools/build/feature-flags.mjs'

/**
 * Guard the deployed artifact. The web build ships the PWA shell; the desktop
 * build must not, or a Tauri bundle would carry a stale service worker.
 *
 * Routes are lazy chunks, so every emitted script is checked, not just the
 * entry: the boundary markers live wherever the importing screen landed. The
 * `/hub` route also carries the shared hub panel (`@clara/panel`), so it has its
 * own size budget and its own build-time feature check.
 */
const args = process.argv.slice(2)
function argument(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const surface = argument('surface', 'web')
const directory = argument('dir', 'dist')
const output = fileURLToPath(new URL(`../${directory}/`, import.meta.url))
const assets = join(output, 'assets')

/** A route chunk this large means a screen was not split, or a dependency leaked. */
const MAX_CHUNK_BYTES = 500 * 1024
/**
 * The bundled hub panel is a lazy route, so it never blocks the first paint and
 * may be larger than a startup chunk. It still gets an explicit budget, below
 * the app budget, so the panel cannot quietly grow into an eager download.
 */
const MAX_PANEL_CHUNK_BYTES = 400 * 1024

// Harness SDK symbols must never reach the browser artifact.
const markers = ['/api/session', '/api/project', 'ClientError', 'OpenCode.make']
// zod is a contract dependency; the browser only calls schema-free helpers.
const forbidden = [['unrecognized_keys', 'zod']]

// The bundled panel compiles its optional Cloudflare relay deployment UI behind
// `__CLARA_CLOUDFLARE_DEPLOYMENT__`. The served panel's build checks the same
// sentinel and API host string.
const PANEL_MARKERS = ['panel-shell', 'panel-titlebar']
const CLOUDFLARE_SENTINEL = 'data-clara-cloudflare-deployment'
const CLOUDFLARE_API_HOST = 'api.cloudflare.com'
const cloudflareEnabled = featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)

if (!existsSync(assets)) {
  console.error(`No ${surface} build found in ${directory}. Run \`vite build\` first.`)
  process.exit(1)
}

const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'))
const entry = scripts.filter((file) => /^index-.*\.js$/.test(file))

if (entry.length === 0) {
  console.error(`No production index bundle found in ${directory}. Run \`vite build\` first.`)
  process.exit(1)
}

const chunks = scripts.map((file) => ({
  file,
  source: readFileSync(join(assets, file), 'utf8'),
  bytes: statSync(join(assets, file)).size,
}))

const violations = []
let panelChunks = 0
let cloudflareUi = false
for (const { file, source, bytes } of chunks) {
  for (const marker of markers) {
    if (source.includes(marker)) violations.push(`${file} contains ${marker}`)
  }
  for (const [marker, dependency] of forbidden) {
    if (source.includes(marker)) violations.push(`${file} bundles ${dependency}`)
  }

  const panel = PANEL_MARKERS.some((marker) => source.includes(marker))
  if (panel) panelChunks += 1
  if (source.includes(CLOUDFLARE_SENTINEL)) cloudflareUi = true
  if (
    !cloudflareEnabled &&
    (source.includes(CLOUDFLARE_SENTINEL) || source.includes(CLOUDFLARE_API_HOST))
  ) {
    violations.push(`${file} bundles the disabled cloudflare deployment feature`)
  }

  const budget = panel ? MAX_PANEL_CHUNK_BYTES : MAX_CHUNK_BYTES
  if (bytes > budget) {
    violations.push(
      `${file} is ${Math.round(bytes / 1024)} kB, over the ${Math.round(budget / 1024)} kB ${
        panel ? 'panel chunk' : 'chunk'
      } budget`
    )
  }
}

if (cloudflareEnabled && panelChunks === 0) {
  violations.push(`the ${surface} build does not contain the bundled hub panel`)
}
if (cloudflareEnabled && !cloudflareUi) {
  violations.push('the enabled build is missing the bundled panel cloudflare deployment UI')
}

const pwaFiles = ['sw.js', 'manifest.webmanifest']
if (surface === 'web') {
  for (const file of pwaFiles) {
    if (!existsSync(join(output, file))) violations.push(`${directory} is missing ${file}`)
  }
} else {
  for (const file of pwaFiles) {
    if (existsSync(join(output, file))) violations.push(`${directory} must not contain ${file}`)
  }
}

if (violations.length > 0) {
  console.error(`The ${surface} bundle is not shippable:`)
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(
  `${surface} bundle is clean (${directory}: ${scripts.length} chunks, ${panelChunks} panel, cloudflare ${
    cloudflareEnabled ? 'enabled' : 'disabled'
  }).`
)
