#!/usr/bin/env node
// Build the single-file `clara` command with the hub panel, the web client, and
// the engine's standard packages and default config embedded.
//
//   node scripts/build-binary.mjs [--target <bun-target>] [--outfile <path>]
//     [--check] [--skip-assets]
//
// `bun` from PATH is used unless BUN_BIN names one. Cross-target builds need
// the matching Bun target: bun-linux-x64, bun-linux-arm64, bun-darwin-x64,
// bun-darwin-arm64, or bun-windows-x64. `--check` runs the dependency check
// without compiling. `--skip-assets` embeds the existing panel and web builds
// instead of rebuilding them; the Turborepo task restores those first. A
// checkout build reports `<package version>-dev+<7-character commit>`; set
// CLARA_VERSION for a release.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVersion } from '../../../tools/build/version.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../..')
const panelDist = join(repoRoot, 'apps', 'hub', 'panel', 'dist')
const webDist = join(repoRoot, 'apps', 'web', 'dist')
const engineRoot = join(repoRoot, 'packages', 'orchestration', 'engine')
const generated = join(packageRoot, 'src', 'embedded-assets.generated.mjs')
const entry = join(packageRoot, 'src', 'main.ts')
const checkOnly = process.argv.includes('--check')
const skipAssets = process.argv.includes('--skip-assets')

const TARGETS = [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-linux-x64-musl',
  'bun-linux-arm64-musl',
  'bun-darwin-x64',
  'bun-darwin-arm64',
  'bun-windows-x64',
  'bun-windows-arm64',
]

const target = arg('--target') ?? hostTarget()
if (!TARGETS.includes(target)) {
  fail(`unknown target ${target}; expected one of ${TARGETS.join(', ')}.`)
}
const executable = target.includes('windows') ? '.exe' : ''
const outfile = resolve(
  packageRoot,
  arg('--outfile') ?? join('dist', 'package', target, `clara${executable}`)
)

const packageVersion = readPackageVersion()
const version = buildVersion({
  packageVersion,
  commit: git(['rev-parse', '--short=7', 'HEAD']) || 'local',
})

if (skipAssets) {
  requireIndex(panelDist, 'hub panel', 'pnpm --filter @clara/hub-panel build')
  requireIndex(webDist, 'web client', 'pnpm --filter @clara/web build')
} else {
  buildPanel()
  buildWeb(version)
}

const sources = [
  ...collect(panelDist, 'panel'),
  ...collect(webDist, 'web'),
  ...collect(join(engineRoot, 'std'), 'engine/std'),
  ...collect(join(engineRoot, 'default'), 'engine/default'),
]
if (sources.length === 0) fail('There are no assets to embed.')

const buildId = writeGenerated(sources)

console.log('Checking that the command bundles without runtime package imports...')
run(process.execPath, [join(here, 'check-bundle.mjs')], repoRoot)
if (checkOnly) {
  console.log('Asset check passed.')
  process.exit(0)
}

mkdirSync(dirname(outfile), { recursive: true })
const bun = process.env.BUN_BIN?.trim() || 'bun'
console.log(`Embedding ${sources.length} file(s) and compiling ${target}...`)
const metadata = buildMetadata(buildId)
console.log(`Version ${metadata.version} (${metadata.commit}, build ${metadata.buildId})`)
run(
  bun,
  [
    'build',
    '--compile',
    '--conditions=bun',
    `--target=${target}`,
    '--define',
    `process.env.CLARA_VERSION=${JSON.stringify(metadata.version)}`,
    '--define',
    `process.env.CLARA_COMMIT=${JSON.stringify(metadata.commit)}`,
    '--define',
    `process.env.CLARA_BUILD_ID=${JSON.stringify(metadata.buildId)}`,
    '--define',
    `process.env.CLARA_RELEASE_PUBLIC_KEY=${JSON.stringify(metadata.publicKey)}`,
    entry,
    '--outfile',
    outfile,
  ],
  repoRoot
)
console.log(`Clara binary: ${outfile}`)

function buildPanel() {
  run('pnpm', ['--filter', '@clara/hub-panel', 'build'], repoRoot)
  requireIndex(panelDist, 'hub panel', 'pnpm --filter @clara/hub-panel build')
}

function buildWeb(version) {
  run('pnpm', ['--filter', '@clara/web', 'build'], repoRoot, {
    ...process.env,
    CLARA_VERSION: version,
  })
  requireIndex(webDist, 'web client', 'pnpm --filter @clara/web build')
}

function requireIndex(directory, label, command) {
  if (!existsSync(join(directory, 'index.html'))) {
    fail(`The ${label} build did not produce index.html. Run \`${command}\` first.`)
  }
}

function collect(directory, prefix) {
  if (!existsSync(directory)) return []
  return listFiles(directory).map((file) => ({
    file,
    name: `${prefix}/${relative(directory, file).split(sep).join('/')}`,
  }))
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
  return `bun-linux-${arch}${isMusl() ? '-musl' : ''}`
}

function isMusl() {
  if (existsSync('/etc/alpine-release')) return true
  const result = spawnSync('ldd', ['--version'], { encoding: 'utf8', timeout: 2_000 })
  return /musl/i.test(`${result.stdout ?? ''}${result.stderr ?? ''}`)
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

function writeGenerated(entries) {
  const imports = []
  const assets = []
  let index = 0
  const hash = createHash('sha256')

  for (const { file, name } of entries) {
    const relativePath = relative(dirname(generated), file).split(sep).join('/')
    const specifier = relativePath.startsWith('.') ? relativePath : `./${relativePath}`
    hash.update(`${name}:`)
    hash.update(readFileSync(file))
    hash.update('\n')
    imports.push(`import a${index} from ${JSON.stringify(specifier)} with { type: 'file' }`)
    assets.push(`  ${JSON.stringify(name)}: a${index}`)
    index += 1
  }

  const buildId = hash.digest('hex').slice(0, 12)
  writeFileSync(
    generated,
    `${imports.join('\n')}\n\nexport const assets = {\n${assets.join(',\n')}\n}\n\nexport const buildId = ${JSON.stringify(buildId)}\n`
  )
  console.log(`Generated ${generated} (${buildId})`)
  return buildId
}

function buildMetadata(buildId) {
  const commit = git(['rev-parse', '--short=8', 'HEAD']) || 'dev'
  const dirty = Boolean(git(['status', '--porcelain']))
  return {
    version,
    commit: dirty ? `${commit}-dirty` : commit,
    buildId,
    publicKey: process.env.CLARA_RELEASE_PUBLIC_KEY?.trim() || '',
  }
}

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

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(`clara binary: ${message}`)
  process.exit(1)
}
