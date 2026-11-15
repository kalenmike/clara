import { INSTALL_KINDS } from '@clara/adapter-install'
import type {
  PanelInstallArtifact,
  PanelInstallManifest,
  PanelInstallRegistry,
  PanelInstallRegistryEntry,
} from '@clara/shared-types'
import type { ServerConfig } from '../config.ts'
import { SERVER_VERSION } from '../version.ts'
import { PanelControlError } from './controls.ts'

export { INSTALL_KINDS }

const CACHE_MS = 5 * 60_000
const ERROR_CACHE_MS = 30_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_VERSION_LENGTH = 128
const MAX_URL_LENGTH = 4_096
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/i
const PLATFORM = /^[a-z0-9][a-z0-9_-]{0,31}$/

type CachedEntry = {
  at: number
  ttl: number
  entry: PanelInstallRegistryEntry
}

export type ResolvedInstallManifest = {
  kind: string
  manifestUrl: string
  manifest: PanelInstallManifest
  installUrl: string
}

export type InstallRegistryOptions = {
  config: ServerConfig
  fetchImpl?: typeof fetch
  now?: () => number
  kinds?: readonly string[]
  log?: (message: string, detail?: unknown) => void
}

/**
 * Reads the static adapter registry that the web deployment hosts. The hub
 * only reads manifests; the install script downloads the adapter on the target.
 */
export class InstallRegistry {
  private readonly options: InstallRegistryOptions
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly kinds: readonly string[]
  private readonly cache = new Map<string, CachedEntry>()

  constructor(options: InstallRegistryOptions) {
    this.options = options
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.kinds = options.kinds ?? INSTALL_KINDS
  }

  baseUrl(): string {
    return this.options.config.adapterRegistryUrl
  }

  source(): PanelInstallRegistry['source'] {
    return this.options.config.sources.adapterRegistryUrl
  }

  manifestUrl(kind: string): string {
    return `${this.baseUrl()}/${encodeURIComponent(kind)}/manifest.json`
  }

  async info(force = false): Promise<PanelInstallRegistry> {
    const entries = await Promise.all(this.kinds.map((kind) => this.entry(kind, force)))
    return { baseUrl: this.baseUrl(), source: this.source(), entries }
  }

  /** The manifest and install script for one harness, or a panel-facing error. */
  async resolved(kind: string, force = false): Promise<ResolvedInstallManifest> {
    const entry = await this.entry(kind, force)
    if (!entry.ok || !entry.manifest) {
      throw new PanelControlError(
        404,
        'adapter_release_missing',
        entry.error ?? `No adapter release is published for ${kind}.`
      )
    }
    return {
      kind,
      manifestUrl: entry.manifestUrl,
      manifest: entry.manifest,
      installUrl: entry.manifest.install,
    }
  }

  private async entry(kind: string, force: boolean): Promise<PanelInstallRegistryEntry> {
    const cached = this.cache.get(kind)
    const now = this.now()
    if (!force && cached && now - cached.at < cached.ttl) return cached.entry

    const manifestUrl = this.manifestUrl(kind)
    try {
      const manifest = await this.fetchManifest(kind, manifestUrl)
      const entry: PanelInstallRegistryEntry = {
        kind,
        manifestUrl,
        ok: true,
        checkedAt: new Date(now).toISOString(),
        manifest,
      }
      this.cache.set(kind, { at: now, ttl: CACHE_MS, entry })
      return entry
    } catch (cause) {
      const entry: PanelInstallRegistryEntry = {
        kind,
        manifestUrl,
        ok: false,
        checkedAt: new Date(now).toISOString(),
        error: errorMessage(cause),
      }
      this.cache.set(kind, { at: now, ttl: ERROR_CACHE_MS, entry })
      this.options.log?.(`could not read the ${kind} adapter manifest`, cause)
      return entry
    }
  }

  private async fetchManifest(kind: string, manifestUrl: string): Promise<PanelInstallManifest> {
    const response = await this.fetchImpl(manifestUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': `clara-hub/${SERVER_VERSION}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`The adapter registry answered ${response.status}`)
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
      throw new Error('The adapter manifest is too large')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('The adapter manifest is not valid JSON')
    }
    return validateManifest(kind, parsed, manifestUrl)
  }
}

export function validateManifest(
  kind: string,
  value: unknown,
  manifestUrl: string
): PanelInstallManifest {
  if (!isRecord(value)) throw new Error('The adapter manifest must be a JSON object')
  if (value.schemaVersion !== 1) throw new Error('Unsupported adapter manifest schema')
  if (value.harness !== kind) {
    throw new Error(`The manifest is for ${String(value.harness)}, not ${kind}`)
  }

  const version = requireText(value.version, 'version', MAX_VERSION_LENGTH)
  const install = resolveDownloadUrl(
    requireText(value.install, 'install', MAX_URL_LENGTH),
    manifestUrl,
    'The install script'
  )
  const installSha256 = requireSha256(value.installSha256, 'installSha256')

  const publishedAt = value.publishedAt
  if (publishedAt !== undefined && typeof publishedAt !== 'string') {
    throw new Error('The manifest publishedAt must be a date string')
  }

  const artifacts: Record<string, PanelInstallArtifact> = {}
  if (!isRecord(value.artifacts) || Object.keys(value.artifacts).length === 0) {
    throw new Error('The manifest must list at least one artifact')
  }
  for (const [platform, artifact] of Object.entries(value.artifacts)) {
    if (!PLATFORM.test(platform)) {
      throw new Error(`Unsupported platform key: ${platform}`)
    }
    if (!isRecord(artifact)) {
      throw new Error(`The ${platform} artifact must be an object`)
    }
    const url = resolveDownloadUrl(
      requireText(artifact.url, `${platform}.url`, MAX_URL_LENGTH),
      manifestUrl,
      `The ${platform} artifact`
    )
    const sha256 = requireSha256(artifact.sha256, `${platform}.sha256`)
    const size = artifact.size
    if (size !== undefined) {
      if (
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size <= 0 ||
        size > MAX_ARTIFACT_BYTES
      ) {
        throw new Error(`The ${platform} artifact size is out of range`)
      }
    }
    artifacts[platform] = { url, sha256, ...(size !== undefined ? { size } : {}) }
  }

  return {
    schemaVersion: 1,
    harness: kind,
    version,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    install,
    installSha256,
    artifacts,
  }
}

function resolveDownloadUrl(value: string, base: string, label: string): string {
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    throw new Error(`${label} URL is invalid`)
  }
  if (url.protocol === 'https:') return url.toString()
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url.toString()
  throw new Error(`${label} must use HTTPS`)
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`The manifest ${field} must be a string`)
  const text = value.trim()
  if (!text || text.length > max) throw new Error(`The manifest ${field} is invalid`)
  return text
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`The manifest ${field} must be a SHA-256 hex digest`)
  }
  return value.toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}
