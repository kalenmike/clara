#!/usr/bin/env node
// Build the single-file hub sidecar with the panel embedded.
//
//   node scripts/build-sidecar.mjs [--target <rust-triple>]

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../../..')
const panelDist = join(repoRoot, 'apps', 'hub', 'panel', 'dist')
const relayDist = join(repoRoot, 'apps', 'hub', 'server', 'dist', 'relay')
const generated = join(packageRoot, 'src', 'embedded-assets.generated.mjs')
const entry = join(packageRoot, 'src', 'entry.ts')
const binaries = join(packageRoot, 'src-tauri', 'binaries')
const cloudflareDeployment = ['1', 'true', 'yes', 'on'].includes(
  process.env.ENABLE_CLOUDFLARE_DEPLOYMENT?.trim().toLowerCase()
)

const bunTargets = {
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
  'aarch64-pc-windows-msvc': 'bun-windows-arm64',
}

const target = resolveTarget(process.argv.slice(2))
const bunTarget = bunTargets[target]
if (!bunTarget) {
  fail(`Unsupported target triple ${target}`)
}

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

mkdirSync(binaries, { recursive: true })
const executable = target.includes('windows') ? '.exe' : ''
const outfile = join(binaries, `clara-server-${target}${executable}`)
const bun = process.env.BUN_BIN?.trim() || 'bun'

console.log(`Embedding ${sources.length} file(s) and compiling ${bunTarget}...`)
run(
  bun,
  [
    'build',
    '--compile',
    '--conditions=bun',
    `--target=${bunTarget}`,
    '--define',
    `process.env.ENABLE_CLOUDFLARE_DEPLOYMENT=${JSON.stringify(
      cloudflareDeployment ? 'true' : 'false'
    )}`,
    entry,
    '--outfile',
    outfile,
  ],
  repoRoot
)
console.log(`Sidecar: ${outfile}`)

function resolveTarget(args) {
  const index = args.indexOf('--target')
  const fromArg = index >= 0 ? args[index + 1] : undefined
  const configured =
    fromArg?.trim() ||
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
    process.env.CARGO_BUILD_TARGET?.trim()
  if (configured) return configured

  const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const host = rustc.status === 0 ? /^host:\s*(\S+)$/m.exec(rustc.stdout)?.[1] : undefined
  if (host) return host

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  return `${arch}-unknown-linux-gnu`
}

function listFiles(directory) {
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
  console.error(`hub sidecar: ${message}`)
  process.exit(1)
}
