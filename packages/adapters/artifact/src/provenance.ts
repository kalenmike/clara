import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** The public adapter registry. Adapters use it when no override is recorded. */
export const DEFAULT_ADAPTER_REGISTRY_URL = 'https://clara.kalenmichael.com/adapters'

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const KIND = /^[a-z0-9][a-z0-9_-]{0,31}$/
const PLATFORM = /^[a-z0-9][a-z0-9_-]{0,31}$/
const SHA256 = /^[a-f0-9]{64}$/i
const MAX_TEXT = 4_096

/**
 * What the installer recorded beside the adapter binary. The adapter uses it
 * to find its own release version and the registry it may pull a newer build
 * from. It never contains credentials or a pairing code.
 */
export type AdapterInstallProvenance = {
  schemaVersion: 1
  kind: string
  version: string
  platform: string
  /** `local` marks a checkout build, which must never self-update. */
  source: 'registry' | 'local'
  /** Present for registry installs. */
  registryUrl?: string
  artifactUrl?: string
  artifactSha256?: string
  /** Install flags replayed by a reinstall or self-update. */
  installArgs?: string[]
  installedAt: string
}

export function isAdapterVersion(value: string): boolean {
  return VERSION.test(value)
}

/** The install record that sits beside the adapter binary. */
export function adapterProvenancePath(root: string): string {
  return join(root, 'install.json')
}

export function readAdapterProvenance(root: string): AdapterInstallProvenance | undefined {
  const path = adapterProvenancePath(root)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterInstallProvenance>
    if (value.schemaVersion !== 1) return undefined
    if (typeof value.kind !== 'string' || !KIND.test(value.kind)) return undefined
    if (typeof value.version !== 'string' || !VERSION.test(value.version)) return undefined
    if (typeof value.platform !== 'string' || !PLATFORM.test(value.platform)) return undefined
    if (value.source !== 'registry' && value.source !== 'local') return undefined
    if (typeof value.installedAt !== 'string' || Number.isNaN(Date.parse(value.installedAt))) {
      return undefined
    }
    const registryUrl = optionalText(value.registryUrl)
    if (value.source === 'registry' && !registryUrl) return undefined
    const artifactUrl = optionalText(value.artifactUrl)
    const artifactSha256 =
      typeof value.artifactSha256 === 'string' && SHA256.test(value.artifactSha256)
        ? value.artifactSha256
        : undefined
    const installArgs = Array.isArray(value.installArgs)
      ? value.installArgs.filter((arg): arg is string => typeof arg === 'string').slice(0, 128)
      : undefined
    return {
      schemaVersion: 1,
      kind: value.kind,
      version: value.version,
      platform: value.platform,
      source: value.source,
      ...(registryUrl ? { registryUrl } : {}),
      ...(artifactUrl ? { artifactUrl } : {}),
      ...(artifactSha256 ? { artifactSha256 } : {}),
      ...(installArgs && installArgs.length > 0 ? { installArgs } : {}),
      installedAt: value.installedAt,
    }
  } catch {
    return undefined
  }
}

/** Write the install record atomically so a status read never sees half of it. */
export function writeAdapterProvenance(
  root: string,
  provenance: AdapterInstallProvenance
): void {
  const path = adapterProvenancePath(root)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

/**
 * The version a running adapter reports. A release build lives in
 * `.../adapters/<kind>/<version>`, so the folder is a reliable fallback while
 * the installer is still writing its record.
 */
export function resolveAdapterVersion(root: string | undefined, fallback: string): string {
  if (root) {
    const recorded = readAdapterProvenance(root)?.version
    if (recorded) return recorded
    const folder = basename(root)
    if (VERSION.test(folder)) return folder
  }
  return fallback
}

/** Drop one-time pairing and secret flags before persisting install arguments. */
export function sanitizeInstallArgs(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith('--')) {
      kept.push(arg)
      continue
    }
    const [name] = arg.split('=', 1)
    if (name === '--reuse-pairing') continue
    const takesValue =
      name === '--pair' ||
      name === '--version' ||
      name === '--registry' ||
      name === '--source' ||
      /(?:password|token|secret|api-?key)/i.test(name ?? '')
    if (takesValue) {
      if (!arg.includes('=')) index += 1
      continue
    }
    kept.push(arg)
  }
  return kept.slice(0, 128)
}

/** The executable name the release archive places in its version directory. */
export function adapterBinaryName(kind: string, platform: string): string {
  return `clara-adapter-${kind}${platform.startsWith('win32') ? '.exe' : ''}`
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > MAX_TEXT) return undefined
  return text
}
