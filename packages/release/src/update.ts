import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaraPaths } from './paths.ts'
import { downloadVerified, extractArchive } from './download.ts'
import {
  fetchManifest,
  GITHUB_RELEASE_BASE_URL,
  releaseBaseUrl,
  type ReleaseManifest,
} from './manifest.ts'
import { platformKey } from './platform.ts'
import {
  activateVersion,
  compareVersions,
  pruneVersions,
  readInstallInfo,
  stageBinary,
  versionBinary,
  writeInstallInfo,
} from './version-store.ts'

export type UpdateCheck = {
  current: string
  manifest: ReleaseManifest
  available: boolean
  platform: string
  artifact: { url: string; sha256: string; size: number }
}

export type UpdateResult = { version: string; binary: string; previous?: string }

export async function checkForUpdate(options: {
  paths: ClaraPaths
  baseUrl?: string
  publicKey?: string
  /** The running command's version when no install record exists. */
  fallbackVersion?: string
  /** Test-only escape hatch for a loopback registry. */
  allowInsecure?: boolean
  fetchImpl?: typeof fetch
}): Promise<UpdateCheck> {
  const platform = platformKey()
  if (!platform) throw new Error(`Clara has no release for ${process.platform}/${process.arch}.`)
  const fetched = await fetchManifest({
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.publicKey ? { publicKey: options.publicKey } : {}),
    ...(options.allowInsecure !== undefined ? { allowInsecure: options.allowInsecure } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    fallbackBaseUrl: GITHUB_RELEASE_BASE_URL,
  })
  const artifact = fetched.manifest.artifacts[platform]
  if (!artifact) throw new Error(`The release has no ${platform} artifact.`)
  const current = readInstallInfo(options.paths)?.version ?? options.fallbackVersion ?? '0.0.0'
  return {
    current,
    manifest: fetched.manifest,
    available: compareVersions(fetched.manifest.version, current) > 0,
    platform,
    artifact,
  }
}

/** Download, verify, extract, and activate one release artifact. */
export async function applyUpdate(options: {
  paths: ClaraPaths
  check: UpdateCheck
  binDir?: string
  onProgress?: (received: number, total: number) => void
  fetchImpl?: typeof fetch
  extract?: (archive: string, directory: string) => void
}): Promise<UpdateResult> {
  const { manifest, platform, artifact } = options.check
  const downloadDir = join(options.paths.cacheDir, 'downloads')
  const extension = artifact.url.toLowerCase().endsWith('.zip') ? 'zip' : 'tar.gz'
  const archive = join(downloadDir, `clara-${manifest.version}-${platform}.${extension}`)

  await downloadVerified({
    url: artifact.url,
    sha256: artifact.sha256,
    dest: archive,
    total: artifact.size,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  })
  try {
    return installArchive({
      paths: options.paths,
      archive,
      version: manifest.version,
      channel: manifest.channel,
      source: artifact.url,
      ...(options.binDir ? { binDir: options.binDir } : {}),
      ...(options.extract ? { extract: options.extract } : { platform }),
    })
  } finally {
    rmSync(archive, { force: true })
  }
}

/**
 * Download and activate the newest published command. This is the bootstrap the
 * adapter uses when the full CLI is not installed; an already-current install
 * only has its launcher refreshed.
 */
export async function installLatest(options: {
  paths: ClaraPaths
  binDir?: string
  baseUrl?: string
  publicKey?: string
  fallbackVersion?: string
  onProgress?: (received: number, total: number) => void
  /** Test-only escape hatch for a loopback registry. */
  allowInsecure?: boolean
  fetchImpl?: typeof fetch
}): Promise<UpdateResult> {
  const check = await checkForUpdate({
    paths: options.paths,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.publicKey ? { publicKey: options.publicKey } : {}),
    ...(options.fallbackVersion ? { fallbackVersion: options.fallbackVersion } : {}),
    ...(options.allowInsecure !== undefined ? { allowInsecure: options.allowInsecure } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
  const installed = readInstallInfo(options.paths)
  if (
    installed &&
    compareVersions(installed.version, check.manifest.version) >= 0 &&
    existsSync(versionBinary(options.paths, installed.version))
  ) {
    const binary = options.binDir
      ? activateVersion(options.paths, installed.version, options.binDir)
      : activateVersion(options.paths, installed.version)
    return {
      version: installed.version,
      binary,
      ...(installed.previous ? { previous: installed.previous } : {}),
    }
  }
  return applyUpdate({
    paths: options.paths,
    check,
    ...(options.binDir ? { binDir: options.binDir } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
}

/** Install a release archive that was downloaded separately. */
export async function applyLocalArchive(options: {
  paths: ClaraPaths
  archive: string
  version: string
  channel?: string
  binDir?: string
  extract?: (archive: string, directory: string) => void
}): Promise<UpdateResult> {
  return installArchive({
    paths: options.paths,
    archive: options.archive,
    version: options.version,
    channel: options.channel ?? 'stable',
    source: options.archive,
    ...(options.binDir ? { binDir: options.binDir } : {}),
    ...(options.extract ? { extract: options.extract } : {}),
  })
}

/** Switch back to the version that was replaced by the last update. */
export function rollback(paths: ClaraPaths, binDir?: string): UpdateResult {
  const info = readInstallInfo(paths)
  if (!info?.previous) throw new Error('There is no previous version to roll back to.')
  if (!existsSync(versionBinary(paths, info.previous))) {
    throw new Error(`Version ${info.previous} is no longer installed.`)
  }
  const target = binDir
    ? activateVersion(paths, info.previous, binDir)
    : activateVersion(paths, info.previous)
  writeInstallInfo(paths, {
    schemaVersion: 1,
    version: info.previous,
    channel: info.channel,
    installedAt: new Date().toISOString(),
    source: 'rollback',
    previous: info.version,
  })
  return { version: info.previous, binary: target, previous: info.version }
}

export function releaseUrl(): string {
  return releaseBaseUrl()
}

function installArchive(options: {
  paths: ClaraPaths
  archive: string
  version: string
  channel: string
  source: string
  binDir?: string
  platform?: string
  extract?: (archive: string, directory: string) => void
}): UpdateResult {
  const previous = readInstallInfo(options.paths)?.version
  const stage = mkdtempSync(join(tmpdir(), 'clara-update-'))
  try {
    if (options.extract) options.extract(options.archive, stage)
    else extractArchive(options.archive, stage, options.platform === 'win32' ? 'win32' : undefined)

    const binary = findBinary(stage, options.version, options.archive)
    if (!binary) throw new Error('The release archive did not contain the clara binary.')
    stageBinary(options.paths, options.version, readFileSync(binary))
    const target = options.binDir
      ? activateVersion(options.paths, options.version, options.binDir)
      : activateVersion(options.paths, options.version)
    writeInstallInfo(options.paths, {
      schemaVersion: 1,
      version: options.version,
      channel: options.channel,
      installedAt: new Date().toISOString(),
      source: options.source,
      ...(previous ? { previous } : {}),
    })
    pruneVersions(options.paths, [options.version, ...(previous ? [previous] : [])])
    return { version: options.version, binary: target, ...(previous ? { previous } : {}) }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

function findBinary(directory: string, version: string, archive: string): string | undefined {
  const windows = archive.toLowerCase().endsWith('.zip')
  const name = windows ? 'clara.exe' : 'clara'
  const direct = join(directory, name)
  if (existsSync(direct)) return direct
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = join(directory, entry.name, name)
    if (existsSync(nested)) return nested
    const versioned = join(directory, entry.name, version, name)
    if (existsSync(versioned)) return versioned
  }
  return undefined
}
