/** The Clara surface a build is running as. */
export type ClaraSurface = 'web' | 'pwa' | 'desktop' | 'hub' | 'lab'

const DEV_VERSION = /-dev(?:[.+]|$)/

/** Whether a version identifies a development build, e.g. `0.1.0-dev+abc1234`. */
export function isDevelopmentVersion(version: string): boolean {
  return DEV_VERSION.test(version)
}

/**
 * Compare two release versions. A release outranks its prerelease. Development
 * builds carry a commit hash in the prerelease, so this is only meaningful for
 * the numeric core; use `isAdapterUpdateAvailable` when a timestamp exists.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index]! - b.numbers[index]!
  }
  if (!a.prerelease && !b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumber = /^\d+$/.test(one)
    const twoNumber = /^\d+$/.test(two)
    if (oneNumber && twoNumber) {
      const difference = Number(one) - Number(two)
      if (difference !== 0) return difference
    } else if (oneNumber) return -1
    else if (twoNumber) return 1
    else if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

export type AdapterUpdateInput = {
  /** The version the connected adapter reports. */
  current: string | undefined
  /** The version the registry publishes. */
  latest: string | undefined
  /** When the installed adapter was installed, if the adapter reports it. */
  currentAt?: string | number
  /** When the registry published the latest adapter release. */
  latestAt?: string | number
}

/**
 * Decide whether a registry release is newer than the connected adapter.
 *
 * A `-dev+<hash>` build cannot be ordered by its hash. When both sides are
 * development builds with the same numeric core, the release timestamps decide.
 * Without timestamps a differing development build is treated as an update so a
 * newer local build is never silently hidden; the adapter refuses a downgrade.
 */
export function isAdapterUpdateAvailable(input: AdapterUpdateInput): boolean {
  const { current, latest } = input
  if (!current || !latest || current === latest) return false
  if (
    isDevelopmentVersion(current) &&
    isDevelopmentVersion(latest) &&
    sameCoreVersion(current, latest)
  ) {
    const currentAt = timestamp(input.currentAt)
    const latestAt = timestamp(input.latestAt)
    if (currentAt !== undefined && latestAt !== undefined) return latestAt > currentAt
    return true
  }
  return compareVersions(latest, current) > 0
}

function sameCoreVersion(left: string, right: string): boolean {
  return coreVersion(left) === coreVersion(right)
}

function coreVersion(value: string): string {
  return value.split('-', 1)[0] ?? value
}

function timestamp(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseVersion(value: string): { numbers: number[]; prerelease?: string[] } {
  const [core, ...rest] = value.split('-')
  const numbers = (core ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const prerelease = rest.join('-')
  return { numbers, ...(prerelease ? { prerelease: prerelease.split('.') } : {}) }
}

const SURFACE_NAMES: Record<ClaraSurface, string> = {
  web: 'Web',
  pwa: 'PWA',
  desktop: 'Desktop',
  hub: 'Hub',
  lab: 'Lab',
}

/** The one label format every surface uses, e.g. `Clara Web · 0.1.0-dev+abc1234`. */
export function claraVersionLabel(surface: ClaraSurface, version: string): string {
  return `Clara ${SURFACE_NAMES[surface]} · ${version}`
}
