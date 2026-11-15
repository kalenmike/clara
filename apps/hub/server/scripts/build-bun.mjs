#!/usr/bin/env node
// Build the single-file hub server with the panel embedded.
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
import { buildVersion } from '../../../../tools/build/version.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../../..')
const panelDist = join(repoRoot, 'apps', 'hub', 'panel', 'dist')
const version = buildVersion({
  packageVersion: readPackageVersion(),
  commit: git(['rev-parse', '--short=7', 'HEAD']) || 'local',
})
const relayDist = join(packageRoot, 'dist', 'relay')
const generated = join(packageRoot, 'src', 'embedded-assets.generated.mjs')
const entry = join(packageRoot, 'src', 'bun.ts')
const cloudflareDeployment = ['1', 'true', 'yes', 'on'].includes(
  process.env.ENABLE_CLOUDFLARE_DEPLOYMENT?.trim().toLowerCase()
)

const target = arg('--target') ?? hostTarget()
const executable = target.includes('windows') ? '.exe' : ''
const outfile = resolve(
  packageRoot,
  arg('--outfile') ?? join('dist', 'bun', `clara-server${executable}`)
)

run('pnpm', ['--filter', '@clara/hub-panel', 'build'], repoRoot)
if (!existsSync(join(panelDist, 'index.html'))) {
  fail('The panel build did not produce index.html.')
}

const files = listFiles(panelDist)
if (files.length === 0) fail('The panel build has no files to embed.')

const sources = files.map((file) => ({
  file,
  name: relative(panelDist, file).split(sep).join('/'),
}))

if (cloudflareDeployment) {
  run('node', ['apps/hub/server/scripts/build-relay.mjs'], repoRoot)
  if (!existsSync(join(relayDist, 'worker.mjs'))) {
    fail('The relay build did not produce worker.mjs.')
  }
  for (const file of listFiles(relayDist)) {
    sources.push({
      file,
      name: `relay/${relative(relayDist, file).split(sep).join('/')}`,
    })
  }
}

writeGenerated(sources)

mkdirSync(dirname(outfile), { recursive: true })
const bun = process.env.BUN_BIN?.trim() || 'bun'

console.log(`Embedding ${sources.length} file(s) and compiling ${target}...`)
run(
  bun,
  [
    'build',
    '--compile',
    '--conditions=bun',
    `--target=${target}`,
    '--define',
    `process.env.ENABLE_CLOUDFLARE_DEPLOYMENT=${JSON.stringify(
      cloudflareDeployment ? 'true' : 'false'
    )}`,
    '--define',
    `process.env.CLARA_VERSION=${JSON.stringify(version)}`,
    entry,
    '--outfile',
    outfile,
  ],
  repoRoot
)
console.log(`Hub binary: ${outfile}`)

function readPackageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

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

function writeGenerated(sources) {
  const imports = []
  const entries = []
  let index = 0
  const hash = createHash('sha256')

  for (const { file, name } of sources) {
    const specifier = relative(dirname(generated), file).split(sep).join('/')
    hash.update(`${name}:`)
    hash.update(readFileSync(file))
    hash.update('\n')
    imports.push(`import a${index} from ${JSON.stringify(specifier)} with { type: 'file' }`)
    entries.push(`  ${JSON.stringify(name)}: a${index}`)
    index += 1
  }

  const buildId = hash.digest('hex').slice(0, 12)
  writeFileSync(
    generated,
    `${imports.join('\n')}\n\nexport const assets = {\n${entries.join(',\n')}\n}\n\nexport const buildId = ${JSON.stringify(buildId)}\n`
  )
  console.log(`Generated ${generated} (${buildId})`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(`hub binary: ${message}`)
  process.exit(1)
}
