import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureEnabled } from '../../../../tools/build/feature-flags.mjs'

const SENTINEL = 'data-clara-cloudflare-deployment'
const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'dist', 'assets')
const enabled = featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)

const files = existsSync(assets)
  ? readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => join(assets, name))
  : []
const text = files.map((path) => readFileSync(path, 'utf8')).join('\n')

if (enabled && !text.includes(SENTINEL)) {
  fail('the cloudflare deployment panel UI is missing from the build')
}
if (!enabled && (text.includes(SENTINEL) || text.includes('api.cloudflare.com'))) {
  fail('the disabled panel build still contains cloudflare deployment code')
}
console.log(
  enabled
    ? 'cloudflare deployment panel UI verified'
    : 'cloudflare deployment panel UI absent as expected'
)

function fail(message) {
  console.error(`check-feature-bundle: ${message}`)
  process.exit(1)
}
