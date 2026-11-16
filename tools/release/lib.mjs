// Shared release registry contracts.

import { assetMetadata } from '../lib/releases.mjs'

export const CLI_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

export const DESKTOP_ASSETS = [
  { platform: 'darwin-arm64', type: 'dmg', pattern: /^Clara_.*_aarch64\.dmg$/i, required: true },
  { platform: 'darwin-x64', type: 'dmg', pattern: /^Clara_.*_x64\.dmg$/i, required: true },
  {
    platform: 'linux-x64',
    type: 'appimage',
    pattern: /^Clara_.*_amd64\.AppImage$/,
    required: true,
  },
  { platform: 'win32-x64', type: 'nsis', pattern: /^Clara_.*_x64.*-setup\.exe$/i, required: true },
  {
    platform: 'linux-arm64',
    type: 'appimage',
    pattern: /^Clara_.*_aarch64\.AppImage$/,
    required: false,
  },
  {
    platform: 'win32-arm64',
    type: 'nsis',
    pattern: /^Clara_.*_arm64.*-setup\.exe$/i,
    required: false,
  },
]

/** Map a desktop release's assets onto the manifest's plain platform keys. */
export function desktopArtifactsFromAssets(assets) {
  const problems = []
  const artifacts = {}
  for (const spec of DESKTOP_ASSETS) {
    const asset = [...assets.values()].find((entry) => spec.pattern.test(entry.name))
    if (!asset) {
      if (spec.required) problems.push(`missing desktop asset for ${spec.platform}`)
      continue
    }
    const metadata = assetMetadata(asset)
    if (!metadata) {
      problems.push(`${asset.name} has no SHA-256 digest`)
      continue
    }
    if (!Number.isInteger(metadata.size) || metadata.size <= 0) {
      problems.push(`${asset.name} has no size`)
      continue
    }
    artifacts[spec.platform] = {
      url: asset.browser_download_url,
      sha256: metadata.sha256,
      size: metadata.size,
      type: spec.type,
    }
  }
  return { artifacts, problems }
}

export function artifactProblems(label, artifact) {
  const problems = []
  if (!artifact || typeof artifact !== 'object') return [`${label} is not an object`]
  if (typeof artifact.url !== 'string' || !artifact.url.startsWith('https://')) {
    problems.push(`${label} URL is not absolute HTTPS`)
  }
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    problems.push(`${label} sha256 is not 64 hex characters`)
  }
  if (!Number.isInteger(artifact.size) || artifact.size <= 0) {
    problems.push(`${label} size is not a positive integer`)
  }
  return problems
}
