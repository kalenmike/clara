// Validation for a generated adapter registry.
//
// The web deployment serves `<registry>/<kind>/manifest.json` plus the install
// script it names. A stale or partial registry installs an adapter that does
// not match the hub, so the deploy check is deliberately strict: every harness,
// every supported target, an absolute artifact URL, and the exact SHA-256 the
// release reports.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assetMetadata } from './releases.mjs'

export const ADAPTER_KINDS = ['opencode', 'claude', 'pi']

export const SUPPORTED_TARGETS = [
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

const MANIFEST_FILE = 'manifest.json'
const SHA256 = /^[a-f0-9]{64}$/i
const SCRIPT_NAME = /^v[^/\\]+-install\.sh$/

/**
 * Check one registry directory.
 *
 * @param {{
 *   directory: string
 *   kinds?: readonly string[]
 *   targets?: readonly string[]
 *   version?: string
 *   releaseAssets?: Map<string, { digest?: string; size?: number }>
 *   allowLocal?: boolean
 * }} input
 * @returns {{ problems: string[]; summaries: { kind: string; version: string; targets: number }[] }}
 */
export function checkRegistry(input) {
  const kinds = input.kinds ?? ADAPTER_KINDS
  const targets = input.targets ?? SUPPORTED_TARGETS
  const problems = []
  const summaries = []

  for (const kind of kinds) {
    const checked = checkKind({ ...input, kind, targets })
    problems.push(...checked.problems)
    if (checked.summary) summaries.push(checked.summary)
  }

  return { problems, summaries }
}

function checkKind(input) {
  const { directory, kind, targets } = input
  const problems = []
  const kindDir = join(directory, kind)
  const manifestPath = join(kindDir, MANIFEST_FILE)

  if (!existsSync(manifestPath)) {
    problems.push(`${kind}: missing ${manifestPath}`)
    return { problems }
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (cause) {
    problems.push(`${kind}: ${manifestPath} is not valid JSON (${message(cause)})`)
    return { problems }
  }
  if (!isRecord(manifest)) {
    problems.push(`${kind}: ${manifestPath} is not an object`)
    return { problems }
  }

  const version = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  if (!version) problems.push(`${kind}: manifest has no version`)
  if (input.version && version !== input.version) {
    problems.push(
      `${kind}: manifest publishes ${version || '(no version)'} but the release is ${input.version}`
    )
  }
  if (manifest.schemaVersion !== 1) {
    problems.push(
      `${kind}: manifest schemaVersion is ${String(manifest.schemaVersion)}, expected 1`
    )
  }
  if (manifest.harness !== kind) {
    problems.push(`${kind}: manifest harness is ${String(manifest.harness)}`)
  }

  checkInstall({ kind, kindDir, manifest, problems })
  checkArtifacts({ ...input, kind, manifest, problems })

  return {
    problems,
    summary:
      problems.length > 0 || !version
        ? undefined
        : { kind, version, targets: Object.keys(manifest.artifacts ?? {}).length },
  }
}

function checkInstall({ kind, kindDir, manifest, problems }) {
  const install = typeof manifest.install === 'string' ? manifest.install : ''
  if (!SCRIPT_NAME.test(install)) {
    problems.push(`${kind}: manifest install is not a v<version>-install.sh file name`)
    return
  }
  const scriptPath = join(kindDir, install)
  if (!existsSync(scriptPath)) {
    problems.push(`${kind}: missing install script ${scriptPath}`)
    return
  }
  const digest = sha256File(scriptPath)
  if (manifest.installSha256 !== digest) {
    problems.push(`${kind}: install script does not match installSha256`)
  }
}

function checkArtifacts({ kind, targets, manifest, problems, releaseAssets, allowLocal }) {
  const artifacts = isRecord(manifest.artifacts) ? manifest.artifacts : undefined
  if (!artifacts) {
    problems.push(`${kind}: manifest has no artifacts`)
    return
  }

  for (const target of targets) {
    const artifact = artifacts[target]
    if (!isRecord(artifact)) {
      problems.push(`${kind}: no artifact for ${target}`)
      continue
    }
    const url = typeof artifact.url === 'string' ? artifact.url.trim() : ''
    if (!url) {
      problems.push(`${kind} ${target}: no artifact URL`)
    } else if (!allowLocal && !url.startsWith('https://')) {
      problems.push(
        `${kind} ${target}: artifact URL is not absolute HTTPS (${url}). ` +
          'A local build cannot be deployed as the web registry.'
      )
    }

    const sha256 = typeof artifact.sha256 === 'string' ? artifact.sha256.trim() : ''
    if (!SHA256.test(sha256)) {
      problems.push(`${kind} ${target}: sha256 is not 64 hex characters`)
    }
    if (artifact.size !== undefined && (!Number.isInteger(artifact.size) || artifact.size <= 0)) {
      problems.push(`${kind} ${target}: size is not a positive integer`)
    }

    if (!releaseAssets || !url) continue
    checkReleaseAsset({ kind, target, url, sha256, releaseAssets, problems })
  }
}

function checkReleaseAsset({ kind, target, url, sha256, releaseAssets, problems }) {
  let name
  try {
    const parsed = new URL(url)
    name = decodeURIComponent(parsed.pathname.split('/').pop() ?? '')
  } catch {
    problems.push(`${kind} ${target}: artifact URL cannot be parsed`)
    return
  }
  const asset = releaseAssets.get(name)
  if (!asset) {
    problems.push(`${kind} ${target}: ${name} is not an asset on the release`)
    return
  }
  const metadata = assetMetadata(asset)
  if (!metadata) {
    problems.push(`${kind} ${target}: the release asset ${name} has no SHA-256 digest`)
    return
  }
  if (metadata.sha256 !== sha256.toLowerCase()) {
    problems.push(`${kind} ${target}: sha256 does not match the release asset ${name}`)
  }
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function message(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}
