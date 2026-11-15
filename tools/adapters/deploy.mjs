#!/usr/bin/env node
// Publish the adapter registry and deploy the web app in one step.
//
//   node tools/adapters/deploy.mjs [--tag <tag|latest>] [--repo <owner/repo>]
//     [--api-url https://api.github.com] [--dir apps/web/public/adapters]
//     [--check]
//
// `latest` pins the newest published adapters-v* release before generating the
// registry, so a release published mid-deploy cannot split the manifest and the
// archives. The generated registry is checked against that release, then the
// web app is deployed. Without this step an install keeps downloading whatever
// adapter the last deployed manifest pointed at.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchLatestAdapterTag, versionFromTag } from './lib/releases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const directory = readString(args.dir, 'apps/web/public/adapters')
const repo = readString(args.repo, process.env.GITHUB_REPOSITORY?.trim() || 'kalenmike/clara')
const apiUrl = readString(
  args['api-url'],
  process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
).replace(/\/+$/, '')

const wanted = readString(args.tag, 'latest')
const tag =
  wanted === 'latest'
    ? await latestTag()
    : versionFromTag(wanted)
      ? wanted
      : fail(`Cannot derive a version from ${wanted}.`)

console.log(`Adapter release: ${tag}`)
console.log(`Registry:        ${resolve(repoRoot, directory)}`)

run(process.execPath, [
  resolve(here, 'build.mjs'),
  '--from-release',
  tag,
  '--repo',
  repo,
  '--api-url',
  apiUrl,
  '--out',
  directory,
])
run(process.execPath, [
  resolve(here, 'check-registry.mjs'),
  '--from-release',
  tag,
  '--repo',
  repo,
  '--api-url',
  apiUrl,
  '--dir',
  directory,
])

if (args.check) {
  console.log('Registry check passed; skipping the web deploy because --check was set.')
} else {
  run('pnpm', ['--filter', '@clara/web', 'run', 'deploy'])
}

async function latestTag() {
  try {
    return await fetchLatestAdapterTag({
      repo,
      apiUrl,
      token: process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim(),
    })
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    // The web deploy's own registry check must verify the tag this run pinned,
    // not whatever `latest` resolves to a moment later.
    env: { ...process.env, CLARA_ADAPTER_RELEASE_TAG: tag },
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
  console.error(`adapters: ${message}`)
  process.exit(1)
}
