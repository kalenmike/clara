import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureEnabled } from '../../../../tools/build/feature-flags.mjs'

const ROUTE_PREFIX = '/panel/api/v1/relay/cloudflare/'
const CLOUDFLARE_API = 'api.cloudflare.com'
const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const enabled = featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)

const files = listFiles(dist).filter((path) => path.endsWith('.js') || path.endsWith('.map'))
const text = files.map((path) => readFileSync(path, 'utf8')).join('\n')
const relayDir = join(dist, 'relay')

if (enabled) {
  if (!text.includes(ROUTE_PREFIX) || !text.includes(CLOUDFLARE_API)) {
    fail('the cloudflare deployment routes are missing from the server bundle')
  }
  if (!existsSync(join(relayDir, 'worker.mjs')) || !existsSync(join(relayDir, 'manifest.json'))) {
    fail('the relay worker artifact is missing; run scripts/build-relay.mjs')
  }
  console.log('cloudflare deployment bundle verified')
} else {
  if (text.includes(ROUTE_PREFIX) || text.includes(CLOUDFLARE_API)) {
    fail('the disabled build still contains cloudflare deployment code')
  }
  if (existsSync(relayDir)) {
    fail('the disabled build still contains the relay worker artifact')
  }
  console.log('cloudflare deployment bundle absent as expected')
}

function listFiles(path) {
  if (!existsSync(path)) return []
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? listFiles(child) : [child]
  })
}

function fail(message) {
  console.error(`check-feature-bundle: ${message}`)
  process.exit(1)
}
