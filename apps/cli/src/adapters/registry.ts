import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PanelInstallArtifact, PanelInstallManifest } from '@clara/shared-types'
import { resolvePaths } from '../paths.ts'
import type { AdapterTarget } from '@clara/adapter-artifact'

export const ADAPTER_KINDS = ['opencode', 'claude', 'pi'] as const
export type AdapterKind = (typeof ADAPTER_KINDS)[number]

export const DEFAULT_ADAPTER_REGISTRY_URL = 'https://clara.kalenmichael.com/adapters'

const FETCH_TIMEOUT_MS = 8_000
const SUCCESS_CACHE_MS = 60_000
const ERROR_CACHE_MS = 15_000
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_TEXT = 256
const SHA256 = /^[a-f0-9]{64}$/i
const PLATFORM = /^[a-z0-9][a-z0-9_-]{0,31}$/

export type AdapterSearchEntry = {
  kind: AdapterKind
  manifestUrl: string
  ok: boolean
  checkedAt: string
  version?: string
  size?: number
  platforms: string[]
  /** Set when the current machine has an artifact. */
  target?: AdapterTarget
  error?: string
}

export type AdapterSearchReport = {
  baseUrl: string
  target?: AdapterTarget
  entries: AdapterSearchEntry[]
}

export type RegistryOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
  cacheMs?: number
  errorCacheMs?: number
}

type CachedEntry = {
  at: number
  ttl: number
  entry: AdapterSearchEntry
  manifest?: PanelInstallManifest
}

export function isAdapterKind(value: string): value is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(value)
}

/**
 * The registry URL is chosen in one order: the explicit env override, then the
 * hub's saved `server.json`, then the published default.
 */
export function resolveRegistryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_ADAPTER_REGISTRY_URL?.trim()
  if (configured) return normalizeBaseUrl(configured, 'CLARA_ADAPTER_REGISTRY_URL')

  const configDir = resolvePaths(env).configDir
  const serverJson = join(configDir, 'server.json')
  const stored = readStoredRegistry(serverJson)
  if (stored) return normalizeBaseUrl(stored, serverJson)
  return DEFAULT_ADAPTER_REGISTRY_URL
}

/** Read adapter manifests from the static release registry. */
export class AdapterRegistry {
  private readonly base: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly cacheMs: number
  private readonly errorCacheMs: number
  private readonly cache = new Map<string, CachedEntry>()

  constructor(options: RegistryOptions = {}) {
    this.base = normalizeBaseUrl(options.baseUrl ?? resolveRegistryUrl(), 'registry URL')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
    this.cacheMs = options.cacheMs ?? SUCCESS_CACHE_MS
    this.errorCacheMs = options.errorCacheMs ?? ERROR_CACHE_MS
  }

  baseUrl(): string {
    return this.base
  }

  manifestUrl(kind: string): string {
    return `${this.base}/${encodeURIComponent(kind)}/manifest.json`
  }

  async manifest(kind: AdapterKind): Promise<PanelInstallManifest> {
    const cached = await this.entry(kind)
    if (!cached.manifest) throw new Error(cached.error ?? `No ${kind} adapter release was found.`)
    return cached.manifest
  }

  /** One row per kind; a missing or broken kind never hides the others. */
  async search(target?: AdapterTarget): Promise<AdapterSearchReport> {
    const entries = await Promise.all(ADAPTER_KINDS.map((kind) => this.entry(kind)))
    return {
      baseUrl: this.base,
      ...(target ? { target } : {}),
      entries: entries.map(({ manifest, ...row }) => {
        const size = target ? manifest?.artifacts[target]?.size : undefined
        return {
          ...row,
          ...(target && row.platforms.includes(target) ? { target } : {}),
          ...(size !== undefined ? { size } : {}),
        }
      }),
    }
  }

  private async entry(
    kind: AdapterKind
  ): Promise<AdapterSearchEntry & { manifest?: PanelInstallManifest }> {
    const cached = this.cache.get(kind)
    if (cached && this.now() - cached.at < cached.ttl) {
      return { ...cached.entry, ...(cached.manifest ? { manifest: cached.manifest } : {}) }
    }

    const manifestUrl = this.manifestUrl(kind)
    try {
      const manifest = await this.fetchManifest(kind, manifestUrl)
      const entry: AdapterSearchEntry = {
        kind,
        manifestUrl,
        ok: true,
        checkedAt: new Date(this.now()).toISOString(),
        version: manifest.version,
        platforms: Object.keys(manifest.artifacts).sort(),
      }
      this.cache.set(kind, { at: this.now(), ttl: this.cacheMs, entry, manifest })
      return { ...entry, manifest }
    } catch (cause) {
      const entry: AdapterSearchEntry = {
        kind,
        manifestUrl,
        ok: false,
        checkedAt: new Date(this.now()).toISOString(),
        platforms: [],
        error: errorMessage(cause),
      }
      this.cache.set(kind, { at: this.now(), ttl: this.errorCacheMs, entry })
      return entry
    }
  }

  private async fetchManifest(
    kind: AdapterKind,
    manifestUrl: string
  ): Promise<PanelInstallManifest> {
    const response = await this.fetchImpl(manifestUrl, {
      headers: { accept: 'application/json', 'user-agent': 'clara-cli' },
      cache: 'no-store',
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`The adapter registry answered ${response.status}.`)
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
      throw new Error('The adapter manifest is too large.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('The adapter manifest is not valid JSON.')
    }
    return validateAdapterManifest(kind, parsed, manifestUrl)
  }
}

export function validateAdapterManifest(
  kind: string,
  value: unknown,
  manifestUrl: string
): PanelInstallManifest {
  if (!isRecord(value)) throw new Error('The adapter manifest must be a JSON object.')
  if (value.schemaVersion !== 1) throw new Error('Unsupported adapter manifest schema.')
  if (value.harness !== kind) {
    throw new Error(`The manifest is for ${String(value.harness)}, not ${kind}.`)
  }

  const version = requireText(value.version, 'version')
  const install = requireDownloadUrl(
    requireText(value.install, 'install'),
    manifestUrl,
    'The install script'
  )
  const installSha256 = requireSha256(value.installSha256, 'installSha256')
  const publishedAt = value.publishedAt
  if (publishedAt !== undefined && typeof publishedAt !== 'string') {
    throw new Error('The manifest publishedAt must be a date string.')
  }

  if (!isRecord(value.artifacts) || Object.keys(value.artifacts).length === 0) {
    throw new Error('The manifest must list at least one artifact.')
  }
  const artifacts: Record<string, PanelInstallArtifact> = {}
  for (const [platform, artifact] of Object.entries(value.artifacts)) {
    if (!PLATFORM.test(platform)) throw new Error(`Unsupported platform key: ${platform}`)
    if (!isRecord(artifact)) throw new Error(`The ${platform} artifact must be an object.`)
    const url = requireDownloadUrl(
      requireText(artifact.url, `${platform}.url`, 4_096),
      manifestUrl,
      `The ${platform} artifact`
    )
    const sha256 = requireSha256(artifact.sha256, `${platform}.sha256`)
    const size = artifact.size
    if (size !== undefined && (typeof size !== 'number' || !Number.isInteger(size) || size <= 0)) {
      throw new Error(`The ${platform} artifact size is invalid.`)
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

function normalizeBaseUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error(`${label} must use HTTPS.`)
  }
  return url.toString().replace(/\/+$/, '')
}

function requireDownloadUrl(value: string, base: string, label: string): string {
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    throw new Error(`${label} URL is invalid.`)
  }
  if (url.protocol === 'https:') return url.toString()
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url.toString()
  throw new Error(`${label} must use HTTPS.`)
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function requireText(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== 'string') throw new Error(`The manifest ${field} must be a string.`)
  const text = value.trim()
  if (!text || text.length > max) throw new Error(`The manifest ${field} is invalid.`)
  return text
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`The manifest ${field} must be a SHA-256 hex digest.`)
  }
  return value.toLowerCase()
}

function readStoredRegistry(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { adapterRegistryUrl?: unknown }
    return typeof value.adapterRegistryUrl === 'string' && value.adapterRegistryUrl.trim()
      ? value.adapterRegistryUrl.trim()
      : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}
