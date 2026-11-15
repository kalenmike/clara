#!/usr/bin/env node
// Verify the adapter registry the web deployment will serve.
//
//   node tools/adapters/check-registry.mjs [--dir apps/web/public/adapters]
//     [--kind opencode,claude,pi] [--targets all|linux-x64,...]
//     [--from-release <tag|latest>] [--repo <owner/repo>]
//     [--api-url https://api.github.com] [--allow-local] [--json]
//
// Without --from-release this is a structural check: every harness has a
// manifest, the install script matches its hash, and every supported target has
// an absolute HTTPS artifact URL. --from-release also compares the manifest
// version and each artifact SHA-256 with the GitHub release, which is what
// catches a registry that was deployed for an older adapter build.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchLatestAdapterTag, fetchReleaseAssets, versionFromTag } from './lib/releases.mjs'
import { ADAPTER_KINDS, SUPPORTED_TARGETS, checkRegistry } from './lib/registry.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const directory = resolve(repoRoot, readString(args.dir, 'apps/web/public/adapters'))
const kinds = parseKinds(args.kind)
const targets = parseTargets(args.targets)
const allowLocal = Boolean(args['allow-local'])
const wanted = readString(args['from-release'], undefined)
const repo = readString(args.repo, process.env.GITHUB_REPOSITORY?.trim() || 'kalenmike/clara')
const apiUrl = readString(
  args['api-url'],
  process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
).replace(/\/+$/, '')

if (wanted && args.offline) fail('--from-release cannot be combined with --offline')

let version
let releaseAssets
if (wanted) {
  const tag = wanted === 'latest' ? await latestTag() : wanted
  version = versionFromTagOrFail(tag)
  releaseAssets = await assets(tag)
}

const result = checkRegistry({
  directory,
  kinds,
  targets,
  ...(version ? { version } : {}),
  ...(releaseAssets ? { releaseAssets } : {}),
  allowLocal,
})

if (args.json) {
  console.log(
    JSON.stringify(
      {
        ok: result.problems.length === 0,
        directory,
        ...(version ? { version } : {}),
        summaries: result.summaries,
        problems: result.problems,
      },
      null,
      2
    )
  )
} else {
  console.log(`Registry: ${directory}`)
  for (const summary of result.summaries) {
    console.log(`  ${summary.kind.padEnd(9)} ${summary.version} (${summary.targets} targets)`)
  }
  for (const problem of result.problems) console.error(`  ${problem}`)
  if (result.problems.length > 0) {
    console.error('adapters: the registry does not match the deployment')
    process.exitCode = 1
  } else {
    console.log(
      wanted
        ? `Registry matches ${wanted === 'latest' ? 'the latest adapter release' : wanted}.`
        : 'Registry structure is valid (offline check).'
    )
  }
}

async function latestTag() {
  try {
    const tag = await fetchLatestAdapterTag({ repo, apiUrl, token: githubToken() })
    console.log(`Latest adapter release: ${tag}`)
    return tag
  } catch (cause) {
    fail(errorMessage(cause))
  }
}

async function assets(tag) {
  try {
    return await fetchReleaseAssets({ repo, apiUrl, tag, token: githubToken() })
  } catch (cause) {
    fail(errorMessage(cause))
  }
}

function versionFromTagOrFail(tag) {
  const value = versionFromTag(tag)
  if (!value) fail(`Cannot derive a version from ${tag}.`)
  return value
}

function githubToken() {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
}

function parseKinds(value) {
  if (!value || value === true || value === 'all') return ADAPTER_KINDS
  const list = String(value)
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean)
  for (const kind of list) {
    if (!ADAPTER_KINDS.includes(kind)) fail(`Unknown adapter kind: ${kind}`)
  }
  return list
}

function parseTargets(value) {
  if (!value || value === true || value === 'all') return SUPPORTED_TARGETS
  const list = String(value)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)
  for (const target of list) {
    if (!SUPPORTED_TARGETS.includes(target)) fail(`Unknown target: ${target}`)
  }
  return list
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

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}
