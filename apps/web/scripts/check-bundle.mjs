import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const markers = ['/api/session', '/api/project', 'ClientError', 'OpenCode.make']
const files = readdirSync(assets).filter((file) => /^index-.*\.js$/.test(file))

if (files.length === 0) {
  console.error('No production index bundle found. Run `vite build` first.')
  process.exit(1)
}

const violations = []
for (const file of files) {
  const source = readFileSync(join(assets, file), 'utf8')
  for (const marker of markers) {
    if (source.includes(marker)) violations.push(`${file} contains ${marker}`)
  }
}

if (violations.length > 0) {
  console.error('The web bundle contains OpenCode runtime markers:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(`Web bundle is clean (${files.join(', ')}).`)
