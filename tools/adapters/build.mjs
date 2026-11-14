#!/usr/bin/env node
// Build the Bun-compiled harness adapters for the host, or for the targets a
// CI matrix supplies, and write the static registry files.
//
//   node tools/adapters/build.mjs [--kind opencode|claude|pi|all]
//     [--version 0.1.0-dev+abc1234] [--tag adapters-v0.1.0-dev+abc1234]
//     [--targets linux-x64,darwin-arm64,...|all] [--all-targets]
//     [--artifact-base https://github.com/<owner>/<repo>/releases/download/<tag>]
//     [--build dist/adapters] [--out dist/adapters]
//     [--artifacts-only] [--skip-build] [--no-adapter-build]
//     [--print-targets]
//
// Local runs default to the host target only. The adapter release workflow
// builds every OS on its own runner, uploads the archives to a GitHub release,
// and generates the registry files the web deployment serves.
//
//   pnpm adapters:build                       # host target, local registry
//   pnpm adapters:build --print-targets       # show the host target
//   pnpm adapters:build --all-targets         # deliberate full local build

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPPORTED_TARGETS = [
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const packageVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
const version = readString(args.version, defaultVersion())
const tag = readString(args.tag, `adapters-v${version}`)
const kinds = parseKinds(args.kind)
const targets = parseTargets(args)
const buildRoot = resolve(repoRoot, readString(args.build, 'dist/adapters'))
const outRoot = resolve(repoRoot, readString(args.out, buildRoot))
const artifactBase = readString(
  args['artifact-base'],
  `https://github.com/kalenmichael/clara/releases/download/${encodeURIComponent(tag)}`
)
const artifactsOnly = Boolean(args['artifacts-only'])
const bun = process.env.BUN_BIN?.trim() || 'bun'

if (args['print-targets']) {
  for (const target of targets) console.log(target)
  process.exit(0)
}

const built = []

if (!args['no-adapter-build'] && kinds.includes('opencode')) {
  runPnpm(['--filter', '@clara/adapter-opencode', 'build'], repoRoot)
}

for (const kind of kinds) {
  const artifactDir = join(buildRoot, kind)
  const registryDir = join(outRoot, kind)
  mkdirSync(artifactDir, { recursive: true })
  if (!artifactsOnly) mkdirSync(registryDir, { recursive: true })

  const artifacts = {}
  for (const target of targets) {
    const file = artifactName(kind, target)
    const path = join(artifactDir, file)
    if (!args['skip-build']) buildArtifact(kind, target, path)
    if (!existsSync(path)) {
      fail(`Missing ${path}. Run without --skip-build first.`)
    }
    artifacts[target] = {
      url: `${artifactBase}/${encodeURIComponent(file)}`,
      sha256: sha256(path),
      size: statSync(path).size,
    }
    built.push(path)
    console.log(`built ${kind} ${target} (${formatSize(artifacts[target].size)})`)
  }

  if (artifactsOnly) continue

  const scriptName = `v${version}-install.sh`
  const script = installScript(kind, artifacts)
  const scriptPath = join(registryDir, scriptName)
  writeFileSync(scriptPath, script, { mode: 0o755 })
  if (process.platform !== 'win32') chmodSync(scriptPath, 0o755)

  const manifest = {
    schemaVersion: 1,
    harness: kind,
    version,
    publishedAt: new Date().toISOString(),
    install: scriptName,
    installSha256: sha256(scriptPath),
    artifacts,
  }
  writeFileSync(join(registryDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${join(registryDir, 'manifest.json')}`)
  console.log(`wrote ${scriptPath}`)
}

console.log('')
console.log(`Artifacts: ${buildRoot}`)
if (!artifactsOnly) console.log(`Registry:  ${outRoot}`)
console.log(`Tag:       ${tag}`)

if (!artifactsOnly) {
  console.log('')
  const complete = SUPPORTED_TARGETS.every((target) => targets.includes(target))
  if (!complete) {
    console.log(
      `Local builds cover ${targets.join(', ')} only. Use the adapter release workflow for a complete release.`
    )
  } else {
    console.log('Publish the artifacts and deploy the registry:')
    console.log(`  gh release create ${tag} ${built.map((path) => quote(path)).join(' ')}`)
    console.log('  # or, when the release already exists:')
    console.log(
      `  gh release upload ${tag} ${built.map((path) => quote(path)).join(' ')} --clobber`
    )
    // CI exports the registry as an artifact; the maintainer deploys the web app.
    if (!process.env.CI && outRoot === resolve(repoRoot, 'apps/web/public/adapters')) {
      console.log('  pnpm deploy:web')
    }
  }
  console.log('')
  console.log(
    `The manifest points at ${artifactBase}. Override it with --artifact-base if the release lives elsewhere.`
  )
}

function buildArtifact(kind, target, path) {
  const temp = mkdtempSync(join(tmpdir(), 'clara-adapter-'))
  try {
    const binary = join(temp, `clara-adapter-${kind}${target.startsWith('win32') ? '.exe' : ''}`)
    const entry = join(repoRoot, 'apps', 'adapters', kind, 'src', 'index.ts')
    run(
      bun,
      [
        'build',
        '--compile',
        `--target=${bunTarget(target)}`,
        '--minify',
        '--outfile',
        binary,
        entry,
      ],
      repoRoot
    )
    if (kind === 'opencode') {
      const plugin = join(repoRoot, 'apps', 'adapters', 'opencode', 'dist', 'plugin')
      if (!existsSync(join(plugin, 'index.js'))) {
        fail('The OpenCode plugin is not built. Run pnpm --filter @clara/adapter-opencode build.')
      }
      cpSync(plugin, join(temp, 'plugin'), { recursive: true })
    }
    run('tar', ['-czf', path, '-C', temp, '.'], repoRoot)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function artifactName(kind, target) {
  return `clara-adapter-${kind}-v${version}-${target}.tar.gz`
}

function installScript(kind, artifacts) {
  const template = readFileSync(join(here, 'install-template.sh'), 'utf8')
  const cases = Object.entries(artifacts)
    .map(([target, artifact]) => `  ${target}) url='${artifact.url}'; sha='${artifact.sha256}' ;;`)
    .join('\n')
  return template
    .replaceAll('__KIND__', kind)
    .replaceAll('__VERSION__', version)
    .replaceAll('__DEFAULT_ARGS__', kind === 'opencode' ? '--no-runner' : '')
    .replaceAll('__ARTIFACT_CASES__', cases)
}

function defaultVersion() {
  const commit = git(['rev-parse', '--short=7', 'HEAD']) ?? 'local'
  return `${packageVersion}-dev+${commit}`
}

function git(command) {
  const result = spawnSync('git', command, { cwd: repoRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() || undefined : undefined
}

function bunTarget(target) {
  return `bun-${target.replace(/^win32-/, 'windows-')}`
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    ...options,
  })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** Windows cannot spawn the pnpm .cmd shim without a shell. */
function runPnpm(args, cwd) {
  run('pnpm', args, cwd, { shell: process.platform === 'win32' })
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      parsed[name] = next
      index += 1
    } else {
      parsed[name] = true
    }
  }
  return parsed
}

function parseKinds(value) {
  if (!value || value === true || value === 'all') return ['opencode', 'claude', 'pi']
  const kinds = String(value)
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean)
  for (const kind of kinds) {
    if (kind !== 'opencode' && kind !== 'claude' && kind !== 'pi') {
      fail(`Unknown adapter kind: ${kind}`)
    }
  }
  return kinds
}

function parseTargets(input) {
  if (input['all-targets']) return [...SUPPORTED_TARGETS]
  if (!input.targets || input.targets === true) return [hostTarget()]
  const text = String(input.targets).trim()
  if (text === 'all') return [...SUPPORTED_TARGETS]
  const targets = text
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)
  for (const target of targets) {
    if (!SUPPORTED_TARGETS.includes(target)) fail(`Unknown target: ${target}`)
  }
  return targets
}

function hostTarget() {
  if (
    process.platform !== 'linux' &&
    process.platform !== 'darwin' &&
    process.platform !== 'win32'
  ) {
    fail(`Local builds are not supported on ${process.platform}`)
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    fail(`Local builds are not supported on ${process.platform}/${process.arch}`)
  }
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const musl = platform === 'linux' && isMusl()
  const target = `${platform}-${process.arch}${musl ? '-musl' : ''}`
  if (!SUPPORTED_TARGETS.includes(target)) fail(`No adapter target for ${target}`)
  return target
}

function isMusl() {
  if (process.platform !== 'linux') return false
  if (existsSync('/etc/alpine-release')) return true
  try {
    const report = process.report?.getReport?.()
    return Boolean(report?.header && !report.header.glibcVersionRuntime)
  } catch {
    return false
  }
}

function readString(value, fallback) {
  if (value === undefined) return fallback
  if (value === true) fail('A value is required for this flag')
  const text = String(value).trim()
  if (!text) fail('A non-empty value is required for this flag')
  return text
}

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function quote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function fail(message) {
  console.error(`adapters: ${message}`)
  process.exit(1)
}
