import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guard the deployed artifact. The web build ships the PWA shell; the desktop
 * build must not, or a Tauri bundle would carry a stale service worker.
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

if (!existsSync(assets)) {
  console.error(`No ${surface} build found in ${directory}. Run \`vite build\` first.`)
  process.exit(1)
}

const markers = ['/api/session', '/api/project', 'ClientError', 'OpenCode.make']
const files = readdirSync(assets).filter((file) => /^index-.*\.js$/.test(file))

if (files.length === 0) {
  console.error(`No production index bundle found in ${directory}. Run \`vite build\` first.`)
  process.exit(1)
}

const violations = []
for (const file of files) {
  const source = readFileSync(join(assets, file), 'utf8')
  for (const marker of markers) {
    if (source.includes(marker)) violations.push(`${file} contains ${marker}`)
  }
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

console.log(`${surface} bundle is clean (${directory}: ${files.join(', ')}).`)
