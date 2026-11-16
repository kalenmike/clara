#!/usr/bin/env node
// Build the signed release registry the website serves.
//
//   CLARA_RELEASE_SIGNING_KEY=<pem> node tools/release/registry.mjs \
//     --out apps/web/public [--cli-tag latest] [--desktop-tag latest]
//
// Reads the newest published command release and desktop release, verifies the
// command manifest and every release asset digest, writes the nested v2
// manifest, and renders installers with the public key and registry URL baked
// in. The generated files are committed like the adapter registry and deployed
// with `pnpm deploy:web` or `pnpm deploy:web:release`.

import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchLatestCommandTag,
  fetchLatestDesktopTag,
  fetchRelease,
  fetchReleaseAssets,
  versionFromTag,
} from '../lib/releases.mjs'
import { artifactProblems, CLI_PLATFORMS, desktopArtifactsFromAssets } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const args = parseArgs(process.argv.slice(2))

const outDir = resolve(repoRoot, readString(args.out, 'apps/web/public'))
const releaseDir = join(outDir, 'release')
const repo = readString(args.repo, process.env.GITHUB_REPOSITORY?.trim() || 'kalenmike/clara')
const apiUrl = readString(
  args['api-url'],
  process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
).replace(/\/+$/, '')
const baseUrl = readString(args['base-url'], 'https://clara.kalenmichael.com/release').replace(
  /\/+$/,
  ''
)
const adaptersRegistry = readString(
  args['adapters-registry'],
  'https://clara.kalenmichael.com/adapters'
).replace(/\/+$/, '')
const installScript = resolve(
  repoRoot,
  readString(args['install-script'], 'apps/cli/scripts/install.sh')
)
const installScriptPs1 = resolve(dirname(installScript), 'install.ps1')
const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()

const cliTag = await resolveTag(args['cli-tag'], fetchLatestCommandTag, 'command')
const cli = await readCommandRelease(cliTag)
const desktop = await readDesktopRelease(args['desktop-tag'])

const manifest = {
  schemaVersion: 2,
  channel: 'stable',
  generatedAt: new Date().toISOString(),
  cli,
  ...(desktop ? { desktop } : {}),
  adapters: { registry: adaptersRegistry },
}

const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
const { privateKey, publicKey } = signingKey()
const signature = sign(null, bytes, privateKey)

mkdirSync(releaseDir, { recursive: true })
writeFileSync(join(releaseDir, 'manifest.json'), bytes)
writeFileSync(join(releaseDir, 'manifest.json.sig'), `${signature.toString('base64')}\n`)
writeFileSync(join(releaseDir, 'public-key.txt'), `${publicKey}\n`)

const shell = renderInstaller(installScript, publicKey)
writeFileSync(join(outDir, 'install'), shell, { mode: 0o755 })
writeFileSync(join(releaseDir, 'install.sh'), shell, { mode: 0o755 })
const powershell = renderInstaller(installScriptPs1, publicKey, false)
writeFileSync(join(outDir, 'install.ps1'), powershell)
writeFileSync(join(releaseDir, 'install.ps1'), powershell)

console.log(`Registry:  ${outDir}`)
console.log(`Command:   ${cli.version} (${cliTag}, ${Object.keys(cli.artifacts).length} targets)`)
if (desktop) {
  console.log(
    `Desktop:   ${desktop.version} (${desktop.tag}, ${Object.keys(desktop.artifacts).length} targets)`
  )
} else {
  console.log('Desktop:   no published desktop release')
}
console.log(`Install:   ${join(outDir, 'install')}`)
console.log(`Manifest:  ${join(releaseDir, 'manifest.json')}`)

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

async function readCommandRelease(tag) {
  const release = await releaseMetadata(tag)
  const version = versionFromTag(tag)
  if (!version) fail(`Cannot derive a command version from ${tag}.`)
  const assets = await assetsFor(tag)
  const manifestAsset = assets.get('manifest.json')
  if (!manifestAsset) fail(`Release ${tag} has no manifest.json asset.`)
  const published = await downloadJson(manifestAsset.browser_download_url)
  if (published?.schemaVersion !== 2 || !published.cli) {
    fail(`Release ${tag} does not publish a v2 command manifest.`)
  }
  if (published.cli.version !== version) {
    fail(`Release ${tag} publishes command version ${published.cli.version}, not ${version}.`)
  }
  const artifacts = published.cli.artifacts
  if (!artifacts || typeof artifacts !== 'object') fail(`Release ${tag} has no command artifacts.`)
  const missing = CLI_PLATFORMS.filter((platform) => !artifacts[platform])
  if (missing.length > 0) fail(`Release ${tag} is missing command targets: ${missing.join(', ')}`)
  for (const [platform, artifact] of Object.entries(artifacts)) {
    const problems = artifactProblems(`command ${platform}`, artifact)
    if (problems.length > 0) fail(problems.join('; '))
  }
  return {
    version,
    tag,
    publishedAt: published.cli.publishedAt ?? release.published_at,
    ...(typeof published.cli.notes === 'string' ? { notes: published.cli.notes } : {}),
    artifacts: Object.fromEntries(
      Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right))
    ),
  }
}

async function readDesktopRelease(value) {
  if (value === 'none') return undefined
  let tag
  try {
    tag = await resolveTag(value, fetchLatestDesktopTag, 'desktop')
  } catch (cause) {
    if (args['require-desktop']) fail(message(cause))
    console.warn(`release registry: ${message(cause)}`)
    return undefined
  }
  const release = await releaseMetadata(tag)
  const assets = await assetsFor(tag)
  const version = versionFromTag(tag)
  if (!version) fail(`Cannot derive a desktop version from ${tag}.`)
  const mapped = desktopArtifactsFromAssets(assets)
  if (mapped.problems.length > 0) fail(`Desktop release ${tag}: ${mapped.problems.join('; ')}`)
  return {
    version,
    tag,
    publishedAt: release.published_at,
    artifacts: Object.fromEntries(
      Object.entries(mapped.artifacts).sort(([left], [right]) => left.localeCompare(right))
    ),
  }
}

async function releaseMetadata(tag) {
  try {
    return await fetchRelease({ repo, apiUrl, tag, token })
  } catch (cause) {
    fail(message(cause))
  }
}

async function assetsFor(tag) {
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

function signingKey() {
  const value = process.env.CLARA_RELEASE_SIGNING_KEY?.trim()
  if (!value) fail('Set CLARA_RELEASE_SIGNING_KEY to an Ed25519 private key in PEM form.')
  const privateKey = createPrivateKey(value)
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('The signing key must be Ed25519.')
  const publicKey = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  return { privateKey, publicKey }
}

function renderInstaller(path, publicKey, shell = true) {
  if (!existsSync(path)) fail(`Missing installer template ${path}.`)
  let text = readFileSync(path, 'utf8')
  text = text.replaceAll('__CLARA_RELEASE_BASE_URL__', baseUrl)
  if (shell) text = text.replaceAll('__CLARA_RELEASE_PUBLIC_KEY__', publicKey)
  return text
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      values[name] = next
      index += 1
    } else {
      values[name] = true
    }
  }
  return values
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
