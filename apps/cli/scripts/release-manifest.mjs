#!/usr/bin/env node
// Build a release manifest from the archives produced by the package workflow.
//
//   node scripts/release-manifest.mjs \
//     --dir dist/release/archives --out dist/release \
//     --version 0.2.0 --tag v0.2.0 --channel stable \
//     --base-url https://github.com/kalenmike/clara/releases/download/v0.2.0 \
//     [--notes notes.md] [--require-platforms]
//
// Archive names are `clara-<platform>.tar.gz` or `clara-<platform>.zip`.
// The manifest is the nested schemaVersion 2 shape with a `cli` component.

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

const PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

const args = parseArgs(process.argv.slice(2))
const directory = resolve(requireArg('dir'))
const output = resolve(requireArg('out'))
const version = requireArg('version')
const tag = typeof args.tag === 'string' ? args.tag : undefined
const channel = args.channel ?? 'stable'
const baseUrl = requireArg('base-url').replace(/\/+$/, '')
const notesFile = args.notes ? resolve(args.notes) : undefined

if (!existsSync(directory)) fail(`no archive directory at ${directory}`)
if (channel !== 'stable' && channel !== 'beta') fail('--channel must be stable or beta')

const artifacts = {}
for (const file of readdirSync(directory)) {
  const match = /^clara-(.+)\.(tar\.gz|zip)$/.exec(file)
  if (!match) continue
  const platform = match[1]
  if (!PLATFORMS.includes(platform)) fail(`unknown platform in ${file}`)
  const path = join(directory, file)
  artifacts[platform] = {
    url: `${baseUrl}/${encodeURIComponent(file)}`,
    sha256: sha256(path),
    size: statSync(path).size,
  }
}

if (Object.keys(artifacts).length === 0) fail('no clara-<platform> archives found')
if (args['require-platforms']) {
  const missing = PLATFORMS.filter((platform) => !artifacts[platform])
  if (missing.length > 0) fail(`missing archives for ${missing.join(', ')}`)
}

const manifest = {
  schemaVersion: 2,
  channel,
  generatedAt: new Date().toISOString(),
  cli: {
    version,
    ...(tag ? { tag } : {}),
    publishedAt: new Date().toISOString(),
    ...(notesFile ? { notes: readFileSync(notesFile, 'utf8').trim() } : {}),
    artifacts: Object.fromEntries(
      Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right))
    ),
  },
  ...(args['adapters-registry'] ? { adapters: { registry: args['adapters-registry'] } } : {}),
}

mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
for (const script of ['install.sh', 'install.ps1']) {
  const source = resolve(import.meta.dirname, script)
  if (existsSync(source)) copyFileSync(source, join(output, script))
}

console.log(`manifest: ${join(output, 'manifest.json')}`)
for (const [platform, artifact] of Object.entries(manifest.cli.artifacts)) {
  console.log(`  ${platform.padEnd(18)} ${formatSize(artifact.size)}  ${basename(artifact.url)}`)
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      values[key] = next
      index += 1
    } else {
      values[key] = true
    }
  }
  return values
}

function requireArg(name) {
  const value = args[name]
  if (typeof value !== 'string' || value.length === 0) fail(`--${name} is required`)
  return value
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fail(message) {
  console.error(`release manifest: ${message}`)
  process.exit(1)
}
