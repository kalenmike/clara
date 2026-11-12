import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const path = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const text = readFileSync(path, 'utf8')
const match = /(?:from\s*|import\s*\()\s*["'](@clara\/[^"']+)["']/.exec(text)

if (match) {
  console.error(`Server bundle still imports ${match[1]} from node_modules.`)
  console.error(
    'Bundle the workspace package with tsup noExternal instead of loading its source at runtime.'
  )
  process.exit(1)
}
