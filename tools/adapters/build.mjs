#!/usr/bin/env node
// Build the Bun-compiled harness adapters and write the static registry files
// that the web deployment serves.
//
//   node tools/adapters/build.mjs [--kind opencode|claude|all]
//     [--version 0.1.0-dev+abc1234] [--targets linux-x64,darwin-arm64,...]
//     [--artifact-base https://github.com/<owner>/<repo>/releases/download/v<version>]
//     [--out apps/web/public/adapters] [--build dist/adapters]
//     [--skip-build] [--no-adapter-build]
//
// The artifacts are written to --build (default dist/adapters) and the
// manifest/install script to --out. Upload the artifacts to the GitHub release
// named by --artifact-base, then deploy the web app.

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

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const packageVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
const version = args.version ?? defaultVersion()
const kinds = parseKinds(args.kind)
const targets = parseTargets(args.targets)
const outRoot = resolve(repoRoot, args.out ?? 'apps/web/public/adapters')
const buildRoot = resolve(repoRoot, args.build ?? 'dist/adapters')
const artifactBase =
  args['artifact-base'] ??
  `https://github.com/kalenmichael/clara/releases/download/v${encodeURIComponent(version)}`
const bun = process.env.BUN_BIN?.trim() || 'bun'

const built = []

if (!args['no-adapter-build'] && kinds.includes('opencode')) {
  run('pnpm', ['--filter', '@clara/adapter-opencode', 'build'], repoRoot)
}

for (const kind of kinds) {
  const artifactDir = join(buildRoot, kind)
  const registryDir = join(outRoot, kind)
  mkdirSync(artifactDir, { recursive: true })
  mkdirSync(registryDir, { recursive: true })

  const artifacts = {}
  for (const target of targets) {
    const file = `v${version}-${target}.tar.gz`
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

  const scriptName = `v${version}-install.sh`
  const script = installScript(kind, artifacts)
  const scriptPath = join(registryDir, scriptName)
  writeFileSync(scriptPath, script, { mode: 0o755 })
  chmodSync(scriptPath, 0o755)

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

const tag = `v${version}`
console.log('')
console.log(`Artifacts: ${buildRoot}`)
console.log(`Registry:  ${outRoot}`)
console.log('')
console.log('Publish the artifacts and deploy the registry:')
console.log(`  gh release create ${tag} ${built.map((path) => quote(path)).join(' ')}`)
console.log('  # or, when the release already exists:')
console.log(`  gh release upload ${tag} ${built.map((path) => quote(path)).join(' ')} --clobber`)
console.log('  pnpm deploy:web')
console.log('')
console.log(
  `The manifest points at ${artifactBase}. Override it with --artifact-base if the release lives elsewhere.`
)

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

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
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
  if (!value || value === 'all') return ['opencode', 'claude']
  const kinds = String(value)
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean)
  for (const kind of kinds) {
    if (kind !== 'opencode' && kind !== 'claude') fail(`Unknown adapter kind: ${kind}`)
  }
  return kinds
}

function parseTargets(value) {
  const supported = [
    'linux-x64',
    'linux-arm64',
    'linux-x64-musl',
    'linux-arm64-musl',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'win32-arm64',
  ]
  if (!value) return supported
  const targets = String(value)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)
  for (const target of targets) {
    if (!supported.includes(target)) fail(`Unknown target: ${target}`)
  }
  return targets
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
