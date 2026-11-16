#!/usr/bin/env node
// Verify the release registry the website will serve.
//
//   node tools/release/check-registry.mjs [--dir apps/web/public] [--offline]
//     [--cli-tag latest|v0.2.0] [--desktop-tag latest|desktop-v0.2.0|none]
//     [--repo <owner/repo>] [--api-url https://api.github.com] [--json]
//
// The offline check validates the manifest, signature, installer substitutions,
// and every CLI and desktop artifact entry. The release check also compares the
// published version and artifact checksums with GitHub.

import { createPublicKey, verify } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchLatestCommandTag,
  fetchLatestDesktopTag,
  fetchReleaseAssets,
  versionFromTag,
} from '../lib/releases.mjs'
import {
  artifactProblems,
  CLI_PLATFORMS,
  DESKTOP_ASSETS,
  desktopArtifactsFromAssets,
} from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))
const directory = resolve(repoRoot, readString(args.dir, 'apps/web/public'))
const releaseDir = join(directory, 'release')
const offline = Boolean(args.offline)
const allowMissing = Boolean(args['allow-missing'])
const repo = readString(args.repo, process.env.GITHUB_REPOSITORY?.trim() || 'kalenmike/clara')
const apiUrl = readString(
  args['api-url'],
  process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
).replace(/\/+$/, '')
const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
const expectedBase = readString(args['base-url'], 'https://clara.kalenmichael.com/release').replace(
  /\/+$/,
  ''
)

const problems = []
const manifestPath = join(releaseDir, 'manifest.json')
const signaturePath = join(releaseDir, 'manifest.json.sig')
const publicKeyPath = join(releaseDir, 'public-key.txt')
const installPath = join(directory, 'install')
const installPs1Path = join(directory, 'install.ps1')

const missing = []
for (const path of [manifestPath, signaturePath, publicKeyPath, installPath, installPs1Path]) {
  if (!existsSync(path)) missing.push(path)
}
if (allowMissing && missing.length === 5) {
  console.log('Release registry is not generated yet; skipping the release check.')
  process.exit(0)
}
for (const path of missing) problems.push(`missing ${path}`)

let manifest
let publicKey
if (problems.length === 0) {
  const bytes = readFileSync(manifestPath)
  publicKey = readFileSync(publicKeyPath, 'utf8').trim()
  const signature = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64')
  if (!verifySignature(bytes, signature, publicKey)) problems.push('manifest signature is invalid')
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch (cause) {
    problems.push(`manifest.json is not valid JSON: ${message(cause)}`)
  }
}

if (manifest) checkManifest(manifest)
if (publicKey) checkInstallers(publicKey)

if (!offline && manifest) {
  await checkReleases(manifest)
}

const result = { ok: problems.length === 0, directory, ...(manifest ? { version: manifest.cli?.version } : {}), problems }
if (args.json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`Registry: ${directory}`)
  if (manifest?.cli) console.log(`  command ${manifest.cli.version}`)
  if (manifest?.desktop) console.log(`  desktop ${manifest.desktop.version}`)
  for (const problem of problems) console.error(`  ${problem}`)
  if (problems.length > 0) {
    console.error('release registry: the registry is not deployable')
    process.exitCode = 1
  } else {
    console.log(offline ? 'Registry structure is valid.' : 'Registry matches the latest releases.')
  }
}

function checkManifest(value) {
  if (value.schemaVersion !== 2) problems.push('schemaVersion is not 2')
  if (value.channel !== 'stable' && value.channel !== 'beta') problems.push('channel is invalid')
  if (!value.cli || typeof value.cli !== 'object') {
    problems.push('manifest has no cli section')
    return
  }
  if (typeof value.cli.version !== 'string' || !value.cli.version) {
    problems.push('cli version is invalid')
  }
  if (typeof value.cli.tag !== 'string' || versionFromTag(value.cli.tag) !== value.cli.version) {
    problems.push('cli tag does not match the version')
  }
  const artifacts = value.cli.artifacts
  if (!artifacts || typeof artifacts !== 'object') {
    problems.push('cli has no artifacts')
    return
  }
  for (const platform of CLI_PLATFORMS) {
    if (!artifacts[platform]) problems.push(`cli is missing ${platform}`)
  }
  for (const [platform, artifact] of Object.entries(artifacts)) {
    problems.push(...artifactProblems(`cli ${platform}`, artifact))
  }

  if (!value.desktop) return
  if (typeof value.desktop.version !== 'string' || !value.desktop.version) {
    problems.push('desktop version is invalid')
  }
  if (
    typeof value.desktop.tag !== 'string' ||
    versionFromTag(value.desktop.tag) !== value.desktop.version
  ) {
    problems.push('desktop tag does not match the version')
  }
  const desktopArtifacts = value.desktop.artifacts
  if (!desktopArtifacts || typeof desktopArtifacts !== 'object') {
    problems.push('desktop has no artifacts')
    return
  }
  const allowed = new Map(DESKTOP_ASSETS.map((entry) => [entry.platform, entry.type]))
  for (const [platform, artifact] of Object.entries(desktopArtifacts)) {
    if (!allowed.has(platform)) {
      problems.push(`desktop has an unknown platform: ${platform}`)
      continue
    }
    problems.push(...artifactProblems(`desktop ${platform}`, artifact))
    if (artifact && typeof artifact === 'object' && artifact.type !== allowed.get(platform)) {
      problems.push(`desktop ${platform} has the wrong type`)
    }
  }
  for (const entry of DESKTOP_ASSETS) {
    if (entry.required && !desktopArtifacts[entry.platform]) {
      problems.push(`desktop is missing ${entry.platform}`)
    }
  }
}

function checkInstallers(key) {
  if (existsSync(installPath)) {
    const text = readFileSync(installPath, 'utf8')
    if (!text.includes(key)) problems.push('install does not embed the public key')
    if (!text.includes(expectedBase)) problems.push('install does not use the registry base URL')
    if (text.includes('__CLARA_RELEASE_PUBLIC_KEY__')) {
      problems.push('install still has the public key placeholder')
    }
    if (text.includes('__CLARA_RELEASE_BASE_URL__')) {
      problems.push('install still has the base URL placeholder')
    }
  }
  if (existsSync(installPs1Path)) {
    const text = readFileSync(installPs1Path, 'utf8')
    if (!text.includes(expectedBase)) problems.push('install.ps1 does not use the registry base URL')
    if (text.includes('__CLARA_RELEASE_BASE_URL__')) {
      problems.push('install.ps1 still has the base URL placeholder')
    }
  }
}

async function checkReleases(value) {
  const cliTag = await resolveTag(args['cli-tag'], fetchLatestCommandTag, 'command')
  const cliAssets = await assets(cliTag)
  const cliManifestAsset = cliAssets.get('manifest.json')
  if (!cliManifestAsset) {
    problems.push(`${cliTag} has no manifest.json asset`)
  } else {
    const published = await downloadJson(cliManifestAsset.browser_download_url)
    if (published?.schemaVersion !== 2 || !published.cli) {
      problems.push(`${cliTag} does not publish a v2 command manifest`)
    } else {
      if (published.cli.version !== value.cli.version) {
        problems.push(`cli version ${value.cli.version} does not match release ${published.cli.version}`)
      }
      compareArtifacts('cli', value.cli.artifacts, published.cli.artifacts)
    }
  }

  if (!value.desktop) return
  const desktopTag = await resolveTag(args['desktop-tag'], fetchLatestDesktopTag, 'desktop')
  if (versionFromTag(desktopTag) !== value.desktop.version) {
    problems.push(`desktop version ${value.desktop.version} does not match release ${desktopTag}`)
  }
  const desktopAssets = await assets(desktopTag)
  const mapped = desktopArtifactsFromAssets(desktopAssets)
  for (const problem of mapped.problems) problems.push(`desktop: ${problem}`)
  compareArtifacts('desktop', value.desktop.artifacts, mapped.artifacts)
}

function compareArtifacts(label, local, published) {
  for (const [platform, artifact] of Object.entries(local)) {
    const other = published[platform]
    if (!other) {
      problems.push(`${label} ${platform} is not on its release`)
      continue
    }
    if (artifact.url !== other.url) problems.push(`${label} ${platform} URL does not match`)
    if (artifact.sha256 !== other.sha256) problems.push(`${label} ${platform} sha256 does not match`)
    if (artifact.size !== other.size) problems.push(`${label} ${platform} size does not match`)
  }
}

async function resolveTag(value, fetchLatest, label) {
  if (!value || value === true || value === 'latest') {
    try {
      return await fetchLatest({ repo, apiUrl, token })
    } catch (cause) {
      fail(`No published ${label} release: ${message(cause)}`)
    }
  }
  const tag = String(value).trim()
  if (!versionFromTag(tag)) fail(`Cannot derive a ${label} version from ${tag}.`)
  return tag
}

async function assets(tag) {
  try {
    return await fetchReleaseAssets({ repo, apiUrl, tag, token })
  } catch (cause) {
    fail(message(cause))
  }
}

async function downloadJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) fail(`Could not download ${url} (HTTP ${response.status}).`)
  return response.json()
}

function verifySignature(bytes, signature, key) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(key, 'base64'),
      format: 'der',
      type: 'spki',
    })
    return verify(null, bytes, publicKey, signature)
  } catch {
    return false
  }
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

function message(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

function fail(value) {
  console.error(`release registry: ${value}`)
  process.exit(1)
}
