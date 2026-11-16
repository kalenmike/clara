#!/usr/bin/env node
// Publish the release registry and deploy the web app in one step.
//
//   node tools/release/deploy.mjs [--from <artifact-dir>] [--check]
//     [--cli-tag latest|v0.2.0] [--desktop-tag latest|desktop-v0.2.0|none]
//     [--repo <owner/repo>] [--api-url https://api.github.com]
//     [--base-url https://clara.kalenmichael.com/release]
//
// Without --from this regenerates the registry from the latest GitHub releases
// and therefore needs CLARA_RELEASE_SIGNING_KEY. With --from it copies the
// signed `release-registry` workflow artifact into the web public directory.
// Either way the registry is checked before the Pages deploy.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const directory = resolve(repoRoot, readString(args.dir, 'apps/web/public'))

if (args.from) {
  copyArtifact(resolve(repoRoot, readString(args.from, 'dist/release-registry')))
} else {
  run(process.execPath, [
    resolve(here, 'registry.mjs'),
    '--out',
    directory,
    ...forwarded([
      'cli-tag',
      'desktop-tag',
      'repo',
      'api-url',
      'base-url',
      'adapters-registry',
      'require-desktop',
    ]),
  ])
}

run(process.execPath, [resolve(here, 'check-registry.mjs'), '--dir', directory, '--offline'])

if (args.check) {
  console.log('Registry check passed; skipping the web deploy because --check was set.')
} else {
  run('pnpm', ['--filter', '@clara/web', 'run', 'deploy'])
  console.log('')
  console.log('Registry files are generated. Commit them before the next deploy:')
  console.log(
    `  git add ${relativePath(repoRoot, join(directory, 'install'))} ${relativePath(repoRoot, join(directory, 'install.ps1'))} ${relativePath(repoRoot, join(directory, 'release'))}`
  )
}

function copyArtifact(from) {
  for (const name of ['install', 'install.ps1', 'release']) {
    if (!existsSync(join(from, name))) fail(`--from is missing ${join(from, name)}`)
  }
  mkdirSync(directory, { recursive: true })
  cpSync(join(from, 'install'), join(directory, 'install'))
  cpSync(join(from, 'install.ps1'), join(directory, 'install.ps1'))
  cpSync(join(from, 'release'), join(directory, 'release'), { recursive: true })
  console.log(`Copied the release registry from ${from}`)
}

function forwarded(names) {
  const values = []
  for (const name of names) {
    const value = args[name]
    if (value === undefined) continue
    values.push(`--${name}`)
    if (value !== true) values.push(String(value))
  }
  return values
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32' && command === 'pnpm',
  })
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

function readString(value, fallback) {
  if (value === undefined) return fallback
  if (value === true) fail('A value is required for this flag')
  const text = String(value).trim()
  if (!text) fail('A non-empty value is required for this flag')
  return text
}

function fail(message) {
  console.error(`release deploy: ${message}`)
  process.exit(1)
}
