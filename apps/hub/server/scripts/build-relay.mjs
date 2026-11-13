import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureEnabled } from '../../../../tools/build/feature-flags.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..', '..')
const outputDir = join(here, '..', 'dist', 'relay')
const entry = join(root, 'infra', 'relay', 'src', 'index.ts')

if (!featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)) {
  rmSync(outputDir, { recursive: true, force: true })
  console.log('cloudflare deployment disabled; skipped the relay worker bundle')
  process.exit(0)
}

mkdirSync(outputDir, { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: join(outputDir, 'worker.mjs'),
  nodePaths: [join(here, '..', 'node_modules')],
  logLevel: 'silent',
})

// Keep these in sync with infra/relay/wrangler.jsonc. A unit test asserts the
// build-time manifest still matches that configuration.
writeFileSync(
  join(outputDir, 'manifest.json'),
  `${JSON.stringify(
    {
      scriptName: 'clara-relay',
      mainModule: 'clara-relay.mjs',
      compatibilityDate: '2026-10-30',
      migrationTag: 'v1',
      durableObject: { binding: 'RELAY_ROOMS', className: 'RelayRoom' },
    },
    null,
    2
  )}\n`
)
console.log(`bundled the relay worker at ${join(outputDir, 'worker.mjs')}`)
