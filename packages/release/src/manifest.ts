import { verify } from 'node:crypto'

export type ReleaseArtifact = {
  url: string
  sha256: string
  size: number
}

export type DesktopArtifactType = 'dmg' | 'appimage' | 'nsis' | 'msi'

export type DesktopArtifact = ReleaseArtifact & {
  type: DesktopArtifactType
}

export type DesktopRelease = {
  version: string
  tag?: string
  publishedAt: string
  notes?: string
  artifacts: Record<string, DesktopArtifact>
}

export type ReleaseManifest = {
  schemaVersion: 2
  version: string
  channel: 'stable' | 'beta'
  publishedAt: string
  notes?: string
  artifacts: Record<string, ReleaseArtifact>
  desktop?: DesktopRelease
  adapters?: { registry?: string }
}

export type FetchedManifest = {
  manifest: ReleaseManifest
  bytes: Buffer
  signature: Buffer
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/i
const PLATFORM = /^[a-z0-9][a-z0-9_-]{0,31}$/
const DESKTOP_TYPES = new Set<DesktopArtifactType>(['dmg', 'appimage', 'nsis', 'msi'])

export const DEFAULT_RELEASE_BASE_URL = 'https://clara.kalenmichael.com/release'
export const GITHUB_RELEASE_BASE_URL = 'https://github.com/kalenmike/clara/releases/latest/download'

export function releaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CLARA_RELEASE_BASE_URL?.trim() || DEFAULT_RELEASE_BASE_URL).replace(/\/+$/, '')
}

/** Parse and validate a nested component manifest from JSON bytes. */
export function parseManifest(
  bytes: Buffer,
  options: { allowInsecure?: boolean } = {}
): ReleaseManifest {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<ReleaseManifest> & {
    cli?: Partial<ReleaseManifest>
  }
  if (value.schemaVersion !== 2) {
    throw new Error('The release manifest has an unknown schema version.')
  }
  if (value.channel !== 'stable' && value.channel !== 'beta') {
    throw new Error('The release manifest has an invalid channel.')
  }
  if (!value.cli || typeof value.cli !== 'object') {
    throw new Error('The release manifest has no CLI release.')
  }
  const cli = value.cli
  if (typeof cli.version !== 'string' || !VERSION.test(cli.version)) {
    throw new Error('The release manifest has an invalid CLI version.')
  }
  if (typeof cli.publishedAt !== 'string' || Number.isNaN(Date.parse(cli.publishedAt))) {
    throw new Error('The release manifest has an invalid CLI publication date.')
  }
  const artifacts = parseArtifacts(cli.artifacts, 'CLI', options)
  if (Object.keys(artifacts).length === 0) {
    throw new Error('The release manifest has no CLI artifacts.')
  }

  const desktop = value.desktop ? parseDesktop(value.desktop, options) : undefined
  const adapters = value.adapters && typeof value.adapters === 'object' ? value.adapters : undefined

  return {
    schemaVersion: 2,
    version: cli.version,
    channel: value.channel,
    publishedAt: cli.publishedAt,
    ...(typeof cli.notes === 'string' ? { notes: cli.notes } : {}),
    artifacts,
    ...(desktop ? { desktop } : {}),
    ...(adapters ? { adapters } : {}),
  }
}

function parseDesktop(
  value: Partial<DesktopRelease>,
  options: { allowInsecure?: boolean }
): DesktopRelease {
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) {
    throw new Error('The release manifest has an invalid desktop version.')
  }
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
    throw new Error('The release manifest has an invalid desktop publication date.')
  }
  if (value.tag !== undefined && typeof value.tag !== 'string') {
    throw new Error('The release manifest has an invalid desktop tag.')
  }
  const artifacts = parseArtifacts(value.artifacts, 'desktop', options, true)
  if (Object.keys(artifacts).length === 0) {
    throw new Error('The release manifest has no desktop artifacts.')
  }
  return {
    version: value.version,
    ...(typeof value.tag === 'string' ? { tag: value.tag } : {}),
    publishedAt: value.publishedAt,
    ...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
    artifacts: artifacts as Record<string, DesktopArtifact>,
  }
}

function parseArtifacts(
  value: Record<string, ReleaseArtifact> | undefined,
  label: string,
  options: { allowInsecure?: boolean },
  desktop = false
): Record<string, ReleaseArtifact> {
  if (!value || typeof value !== 'object') {
    throw new Error(`The release manifest has no ${label} artifacts.`)
  }
  const artifacts: Record<string, ReleaseArtifact> = {}
  for (const [platform, artifact] of Object.entries(value)) {
    if (!PLATFORM.test(platform)) {
      throw new Error(`The release manifest has an invalid ${label} platform: ${platform}`)
    }
    if (!artifact || typeof artifact !== 'object') {
      throw new Error(`The release manifest has no ${label} artifact for ${platform}.`)
    }
    const { url, sha256, size } = artifact as Partial<DesktopArtifact>
    if (typeof url !== 'string' || !isAllowedUrl(url, options.allowInsecure)) {
      throw new Error(`The ${label} artifact URL for ${platform} must use https.`)
    }
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
      throw new Error(`The ${label} artifact for ${platform} has an invalid checksum.`)
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      throw new Error(`The ${label} artifact for ${platform} has an invalid size.`)
    }
    if (desktop) {
      const type = (artifact as Partial<DesktopArtifact>).type
      if (typeof type !== 'string' || !DESKTOP_TYPES.has(type as DesktopArtifactType)) {
        throw new Error(`The desktop artifact for ${platform} has an invalid type.`)
      }
    }
    artifacts[platform] = { url, sha256: sha256.toLowerCase(), size }
    if (desktop) {
      const type = (artifact as Partial<DesktopArtifact>).type as DesktopArtifactType
      artifacts[platform] = { ...artifacts[platform], type } as DesktopArtifact
    }
  }
  return artifacts
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
  fallbackBaseUrl?: string
  fetchImpl?: typeof fetch
}): Promise<FetchedManifest> {
  const primary = (options.baseUrl ?? releaseBaseUrl()).replace(/\/+$/, '')
  try {
    return await fetchFrom(primary, options)
  } catch (cause) {
    const explicit = Boolean(options.baseUrl || process.env.CLARA_RELEASE_BASE_URL?.trim())
    if (explicit || !options.fallbackBaseUrl) throw cause
    return fetchFrom(options.fallbackBaseUrl.replace(/\/+$/, ''), options)
  }
}

async function fetchFrom(
  base: string,
  options: {
    publicKey?: string
    allowInsecure?: boolean
    fetchImpl?: typeof fetch
  }
): Promise<FetchedManifest> {
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
