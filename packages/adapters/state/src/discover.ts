import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  adapterBinaryName,
  compareVersions,
  detectAdapterTarget,
  isAdapterVersion,
  readAdapterProvenance,
} from '@clara/adapter-artifact'
import {
  readAdapterState,
  type AdapterInstallRecord,
  type AdapterStateFile,
  type AdapterStatePaths,
} from './records.ts'

export type DiscoverAdapterRecordsOptions = {
  paths: AdapterStatePaths
  kinds: readonly string[]
  /** The platform key to assume when a version directory has no install record. */
  platform?: string
}

/**
 * Adapter installers write their own `install.json` beside the binary. A host
 * that installed an adapter without the CLI therefore has enough on disk to
 * rebuild the install record the CLI reads.
 */
export function discoverAdapterRecords(
  options: DiscoverAdapterRecordsOptions
): AdapterInstallRecord[] {
  const records: AdapterInstallRecord[] = []
  for (const kind of options.kinds) {
    const record = discoverKind(kind, options)
    if (record) records.push(record)
  }
  return records
}

/** Stored records win; a discovered install only fills a missing or stale host path. */
export function withDiscoveredAdapterRecords<K extends string>(
  state: AdapterStateFile<K>,
  discovered: readonly AdapterInstallRecord<K>[]
): AdapterStateFile<K> {
  const adapters = { ...state.adapters }
  for (const record of discovered) {
    const existing = adapters[record.kind]
    if (!existing) {
      adapters[record.kind] = record
      continue
    }
    if (existing.container) continue
    if (existing.path && existsSync(existing.path)) continue
    adapters[record.kind] = record
  }
  return { schemaVersion: 1, adapters }
}

/** The stored records plus any standalone install the adapter wrote itself. */
export function readAdapterRecords<K extends string>(
  paths: AdapterStatePaths,
  kinds: readonly K[]
): AdapterStateFile<K> {
  return withDiscoveredAdapterRecords(
    readAdapterState<K>(paths, { kinds }),
    discoverAdapterRecords({ paths, kinds }) as AdapterInstallRecord<K>[]
  )
}

function discoverKind(
  kind: string,
  options: DiscoverAdapterRecordsOptions
): AdapterInstallRecord | undefined {
  const kindRoot = join(options.paths.dataDir, 'adapters', kind)
  let entries: string[]
  try {
    entries = readdirSync(kindRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isAdapterVersion(entry.name))
      .map((entry) => entry.name)
  } catch {
    return undefined
  }

  let best: AdapterInstallRecord | undefined
  for (const version of entries) {
    const root = join(kindRoot, version)
    const provenance = readAdapterProvenance(root)
    // `install.json` is the adapter installer's proof it owns this directory.
    // Without it, a leftover version directory is not an installed adapter.
    if (!provenance) continue
    const platform = provenance.platform ?? options.platform ?? hostPlatform()
    const binary = join(root, adapterBinaryName(kind, platform))
    if (!existsSync(binary)) continue
    const installedAt = provenance?.installedAt ?? modifiedAt(binary)
    const pairedAt = pairingTime(options.paths, kind, installedAt)
    const candidate: AdapterInstallRecord = {
      kind,
      version: provenance?.version ?? version,
      platform,
      path: root,
      installedAt,
      ...(pairedAt ? { pairedAt } : {}),
      ...(provenance?.installArgs && provenance.installArgs.length > 0
        ? { installArgs: provenance.installArgs }
        : {}),
    }
    if (!best || compareVersions(candidate.version, best.version) > 0) best = candidate
  }
  return best
}

function pairingTime(paths: AdapterStatePaths, kind: string, fallback: string): string | undefined {
  const config = join(paths.configDir, 'adapters', kind, 'config.json')
  if (!existsSync(config)) return undefined
  return modifiedAt(config) || fallback
}

function modifiedAt(path: string): string {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function hostPlatform(): string {
  try {
    return detectAdapterTarget()
  } catch {
    return `${process.platform}-${process.arch}`
  }
}
