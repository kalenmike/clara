#!/usr/bin/env node
// Build the orchestration service as one Bun executable with the engine's
// standard packages and default config embedded.
//
//   node scripts/build-bun.mjs [--target <bun-target>] [--outfile <path>]
//
// `bun` from PATH is used unless BUN_BIN names one. Cross-target builds need
// the matching Bun target: bun-linux-x64, bun-linux-arm64, bun-darwin-x64,
// bun-darwin-arm64, bun-windows-x64, or bun-windows-arm64.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../..')
const engineRoot = join(repoRoot, 'packages/orchestration/engine')
const srcDir = join(packageRoot, 'src')
const generated = join(srcDir, 'embedded-assets.generated.mjs')
const entry = join(srcDir, 'bun.ts')

const target = arg('--target') ?? hostTarget()
const executable = target.includes('windows') ? '.exe' : ''
const outfile = resolve(
  packageRoot,
  arg('--outfile') ?? join('dist', 'bun', `clara-orchestrator${executable}`)
)

const files = []
for (const directory of ['std', 'default']) {
  const root = join(engineRoot, directory)
  for (const file of listFiles(root)) {
    files.push({
      file,
      name: `${directory}/${relative(root, file).split(sep).join('/')}`,
    })
  }
}
if (!files.length) fail('The engine has no std or default assets to embed.')

writeGenerated(files)

mkdirSync(dirname(outfile), { recursive: true })
const bun = process.env.BUN_BIN?.trim() || 'bun'
console.log(`Embedding ${files.length} file(s) and compiling ${target}...`)
run(
  bun,
  ['build', '--compile', '--conditions=bun', `--target=${target}`, entry, '--outfile', outfile],
  repoRoot
)
console.log(`Executable: ${outfile}`)

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} needs a value.`)
  return value.trim()
}

function hostTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `bun-darwin-${arch}`
  if (process.platform === 'win32') return `bun-windows-${arch}`
  return `bun-linux-${arch}`
}

function listFiles(directory) {
  if (!existsSync(directory)) return []
  const entries = readdirSync(directory, { withFileTypes: true })
  return entries
    .flatMap((entry) => {
      const full = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(full) : [full]
    })
    .sort()
}

function writeGenerated(entries) {
  const imports = []
  const lines = []
  let index = 0
  const hash = createHash('sha256')

  for (const { file, name } of entries) {
    const relativePath = relative(srcDir, file).split(sep).join('/')
    const specifier = relativePath.startsWith('.') ? relativePath : `./${relativePath}`
    hash.update(`${name}:`)
    hash.update(readFileSync(file))
    hash.update('\n')
    imports.push(`import a${index} from ${JSON.stringify(specifier)} with { type: 'file' }`)
    lines.push(`  ${JSON.stringify(name)}: a${index}`)
    index += 1
  }

  const buildId = hash.digest('hex').slice(0, 12)
  writeFileSync(
    generated,
    `${imports.join('\n')}\n\nexport const assets = {\n${lines.join(',\n')}\n}\n\nexport const buildId = ${JSON.stringify(buildId)}\n`
  )
  console.log(`Generated ${generated} (${buildId})`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(`orchestrator bun build: ${message}`)
  process.exit(1)
}
