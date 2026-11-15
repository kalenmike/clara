import { verify } from 'node:crypto'

export type ReleaseArtifact = {
  url: string
  sha256: string
  size: number
}

export type ReleaseManifest = {
  schemaVersion: 1
  version: string
  channel: 'stable' | 'beta'
  publishedAt: string
  notes?: string
  artifacts: Record<string, ReleaseArtifact>
  adapters?: { registry?: string }
}

export type FetchedManifest = {
  manifest: ReleaseManifest
  bytes: Buffer
  signature: Buffer
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/i

export const DEFAULT_RELEASE_BASE_URL =
  'https://github.com/kalenmike/clara/releases/latest/download'

export function releaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CLARA_RELEASE_BASE_URL?.trim() || DEFAULT_RELEASE_BASE_URL).replace(/\/+$/, '')
}

/** Parse and validate a release manifest from JSON bytes. */
export function parseManifest(
  bytes: Buffer,
  options: { allowInsecure?: boolean } = {}
): ReleaseManifest {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<ReleaseManifest>
  if (value.schemaVersion !== 1)
    throw new Error('The release manifest has an unknown schema version.')
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) {
    throw new Error('The release manifest has an invalid version.')
  }
  if (value.channel !== 'stable' && value.channel !== 'beta') {
    throw new Error('The release manifest has an invalid channel.')
  }
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
    throw new Error('The release manifest has an invalid publication date.')
  }
  if (!value.artifacts || typeof value.artifacts !== 'object') {
    throw new Error('The release manifest has no artifacts.')
  }
  const artifacts: Record<string, ReleaseArtifact> = {}
  for (const [platform, artifact] of Object.entries(value.artifacts)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(platform)) {
      throw new Error(`The release manifest has an invalid platform: ${platform}`)
    }
    if (!artifact || typeof artifact !== 'object') {
      throw new Error(`The release manifest has no artifact for ${platform}.`)
    }
    const { url, sha256, size } = artifact as Partial<ReleaseArtifact>
    if (typeof url !== 'string' || !isAllowedUrl(url, options.allowInsecure)) {
      throw new Error(`The ${platform} artifact URL must use https.`)
    }
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
      throw new Error(`The ${platform} artifact has an invalid checksum.`)
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      throw new Error(`The ${platform} artifact has an invalid size.`)
    }
    artifacts[platform] = { url, sha256: sha256.toLowerCase(), size }
  }
  return {
    schemaVersion: 1,
    version: value.version,
    channel: value.channel,
    publishedAt: value.publishedAt,
    ...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
    artifacts,
    ...(value.adapters ? { adapters: value.adapters } : {}),
  }
}

/**
 * Verify a detached Ed25519 signature over the exact manifest bytes.
 * `publicKey` is a PEM string or a base64 SPKI key.
 */
export function verifyManifestSignature(
  bytes: Buffer,
  signature: Buffer,
  publicKey: string
): boolean {
  const key = normalizeKey(publicKey)
  try {
    return verify(null, bytes, key, signature)
  } catch {
    return false
  }
}

export async function fetchManifest(options: {
  baseUrl?: string
  publicKey?: string
  allowInsecure?: boolean
  fetchImpl?: typeof fetch
}): Promise<FetchedManifest> {
  const base = (options.baseUrl ?? releaseBaseUrl()).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const [manifestResponse, signatureResponse] = await Promise.all([
    fetchImpl(`${base}/manifest.json`, { signal: AbortSignal.timeout(20_000) }),
    fetchImpl(`${base}/manifest.json.sig`, { signal: AbortSignal.timeout(20_000) }),
  ])
  if (!manifestResponse.ok) {
    throw new Error(`Could not read the release manifest (HTTP ${manifestResponse.status}).`)
  }
  if (!signatureResponse.ok) {
    throw new Error(`Could not read the release signature (HTTP ${signatureResponse.status}).`)
  }
  const bytes = Buffer.from(await manifestResponse.arrayBuffer())
  const signature = Buffer.from((await signatureResponse.text()).trim(), 'base64')
  const manifest = parseManifest(bytes, { allowInsecure: options.allowInsecure })
  const publicKey = options.publicKey ?? process.env.CLARA_RELEASE_PUBLIC_KEY?.trim()
  if (!publicKey)
    throw new Error('This build has no release public key, so it cannot verify updates.')
  if (!verifyManifestSignature(bytes, signature, publicKey)) {
    throw new Error('The release manifest signature did not match.')
  }
  return { manifest, bytes, signature }
}

function normalizeKey(value: string): string | Buffer {
  const trimmed = value.trim()
  if (trimmed.includes('BEGIN PUBLIC KEY')) return trimmed
  return Buffer.from(trimmed, 'base64')
}

function isAllowedUrl(value: string, allowInsecure: boolean | undefined): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (allowInsecure === true && url.protocol === 'http:')
  } catch {
    return false
  }
}
