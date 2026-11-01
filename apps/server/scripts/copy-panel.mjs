import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', '..', 'panel', 'dist')
const target = join(here, '..', 'dist', 'panel')

if (!existsSync(join(source, 'index.html'))) {
  console.error(
    'The panel build is missing. Run `pnpm --filter @clara/panel build` before building the agent.'
  )
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`copied panel assets to ${target}`)
