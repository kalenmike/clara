import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  adapterBinaryName,
  detectAdapterTarget,
  isAdapterVersion,
  readAdapterProvenance,
  resolveAdapterVersion,
  sanitizeInstallArgs,
  writeAdapterProvenance,
  type AdapterInstallProvenance,
} from '@clara/adapter-artifact'
import { selfEntry } from './service.ts'

/**
 * The directory that holds this adapter's executable and install record.
 * Compiled releases have no script argument, so `process.execPath` is the
 * binary itself.
 */
export function adapterInstallRoot(entry = selfEntry()): string | undefined {
  if (entry) return dirname(resolve(entry))
  return dirname(process.execPath)
  return undefined
}

/** The release version this adapter runs, recorded at install time when possible. */
export function adapterVersion(fallback: string): string {
  return resolveAdapterVersion(adapterInstallRoot(), fallback)
}

/** True when a reinstall or self-update can trust this directory as the install. */
export function recordableInstallRoot(kind: string): string | undefined {
  const root = adapterInstallRoot()
  if (!root) return undefined
  if (isAdapterVersion(root.split(/[\\/]/).pop() ?? '')) return root
  return existsSync(join(root, adapterBinaryName(kind, hostPlatform()))) ? root : undefined
}

export type InstallProvenanceInput = {
  kind: string
  version: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
}

/**
 * Write the install record beside the adapter binary. The installer supplies
 * the registry through the environment; a missing value means the adapter
 * cannot self-update, which is safer than guessing a different registry.
 */
export function recordInstallProvenance(input: InstallProvenanceInput): void {
  if (input.args.includes('--dry-run')) return
  const root = recordableInstallRoot(input.kind)
  if (!root) return
  const source = input.env.CLARA_ADAPTER_SOURCE?.trim() === 'local' ? 'local' : 'registry'
  const registryUrl = input.env.CLARA_ADAPTER_REGISTRY_URL?.trim().replace(/\/+$/, '')
  if (source === 'registry' && !registryUrl) return
  const version = input.env.CLARA_ADAPTER_VERSION?.trim() || input.version
  if (!isAdapterVersion(version)) return
  const installArgs = sanitizeInstallArgs(input.args)
  const provenance: AdapterInstallProvenance = {
    schemaVersion: 1,
    kind: input.kind,
    version,
    platform: hostPlatform(),
    source,
    ...(source === 'registry' && registryUrl ? { registryUrl } : {}),
    ...(installArgs.length > 0 ? { installArgs } : {}),
    installedAt: new Date().toISOString(),
  }
  try {
    writeAdapterProvenance(root, provenance)
  } catch (cause) {
    console.error(
      `warn could not record the adapter install record: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
  }
}

/** Read the record for diagnostics; undefined when this adapter has none. */
export function readInstallProvenance(): AdapterInstallProvenance | undefined {
  const root = adapterInstallRoot()
  return root ? readAdapterProvenance(root) : undefined
}

function hostPlatform(): string {
  try {
    return detectAdapterTarget()
  } catch {
    return `${process.platform}-${process.arch}`
  }
}
