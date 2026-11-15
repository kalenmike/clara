import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Every target the adapter release workflow publishes. */
export const ADAPTER_TARGETS = [
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
] as const

export type AdapterTarget = (typeof ADAPTER_TARGETS)[number]

export function isAdapterTarget(value: string): value is AdapterTarget {
  return (ADAPTER_TARGETS as readonly string[]).includes(value)
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string, arch: string) {
    super(
      `Clara has no adapter build for ${platform}-${arch}.\n` +
        `Supported targets: ${ADAPTER_TARGETS.join(', ')}.`
    )
    this.name = 'UnsupportedPlatformError'
  }
}

export type PlatformProbe = {
  platform?: string
  arch?: string
  /** Skip libc detection. Linux defaults to the running machine. */
  musl?: boolean
}

export type MuslProbe = {
  exists?: (path: string) => boolean
  ldd?: () => string
}

/** Detect whether the running Linux uses musl instead of glibc. */
export function detectMusl(probe: MuslProbe = {}): boolean {
  const exists = probe.exists ?? existsSync
  if (exists('/etc/alpine-release')) return true
  const output = (probe.ldd ?? readLddVersion)()
  return /\bmusl\b/i.test(output)
}

/** The release target for this machine, or a clear unsupported error. */
export function detectAdapterTarget(probe: PlatformProbe = {}): AdapterTarget {
  const platform = probe.platform ?? process.platform
  const arch = probe.arch ?? process.arch
  const target = targetFor(platform, arch, probe.musl)
  if (target) return target
  throw new UnsupportedPlatformError(platform, arch)
}

export function targetFor(
  platform: string,
  arch: string,
  musl?: boolean
): AdapterTarget | undefined {
  const architecture = arch === 'x64' || arch === 'arm64' ? arch : undefined
  if (!architecture) return undefined
  if (platform === 'darwin') return `darwin-${architecture}`
  if (platform === 'win32') return `win32-${architecture}`
  if (platform !== 'linux') return undefined
  return musl ? `linux-${architecture}-musl` : `linux-${architecture}`
}

function readLddVersion(): string {
  try {
    const result = spawnSync('ldd', ['--version'], { encoding: 'utf8' })
    return `${result.stdout ?? ''}${result.stderr ?? ''}`
  } catch {
    return ''
  }
}
