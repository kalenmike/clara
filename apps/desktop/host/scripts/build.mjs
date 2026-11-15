#!/usr/bin/env node
// Compile the adapter host into the Tauri externalBin name for this target.
//
//   node scripts/build.mjs [--target <rust-triple>]

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const tauriRoot = resolve(packageRoot, '../src-tauri')
const binaries = join(tauriRoot, 'binaries')
const entry = join(packageRoot, 'src', 'index.ts')

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
if (!bunTarget) fail(`Unsupported target triple ${target}`)

mkdirSync(binaries, { recursive: true })
const executable = target.includes('windows') ? '.exe' : ''
const outfile = join(binaries, `clara-adapter-host-${target}${executable}`)
const bun = process.env.BUN_BIN?.trim() || 'bun'

console.log(`Compiling adapter host for ${bunTarget}...`)
const result = spawnSync(
  bun,
  ['build', '--compile', '--conditions=bun', `--target=${bunTarget}`, entry, '--outfile', outfile],
  { stdio: 'inherit', env: process.env }
)
if (result.error) fail(`bun could not run: ${result.error.message}`)
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Adapter host: ${outfile}`)

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

function fail(message) {
  console.error(`adapter host: ${message}`)
  process.exit(1)
}
