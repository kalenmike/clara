import { existsSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  adapterBinaryName,
  detectAdapterTarget,
  sanitizeInstallArgs,
} from '@clara/adapter-artifact'
import {
  deleteAdapterRecord,
  readAdapterRecords,
  saveAdapterRecord,
  type AdapterInstallRecord,
} from '@clara/adapter-state'
import { defaultBinDir, linkBinary, removeBinaryLink } from '@clara/release'
import { adapterInstallRoot } from './provenance.ts'
import { claraPaths } from './paths.ts'
import { selfEntry } from './service.ts'

export type AdapterRecordInput = {
  name: string
  version: string
  /** The script path when this adapter runs as a Node/Bun entry. */
  entry?: string
  /** The install directory; defaults to the running binary's directory. */
  root?: string
  /** Install arguments replayed on a reinstall. */
  args: readonly string[]
  /** Whether a pairing config exists after the install. */
  paired: boolean
  /** A container has no host record to write; the CLI records it by container. */
  containerized?: boolean
  env?: NodeJS.ProcessEnv
  now?: () => Date
}

export type AdapterRecordResult = {
  record: AdapterInstallRecord
  link?: { path: string; target: string }
  warning?: string
}

/**
 * Write the same `adapters.json` record `clara adapter install` writes, and
 * point a user command at the installed binary. Best-effort: a read-only home
 * directory must not fail an otherwise successful install.
 */
export function recordAdapterInstall(input: AdapterRecordInput): AdapterRecordResult | undefined {
  const env = input.env ?? process.env
  if (input.containerized) return undefined
  const paths = claraPaths(env)
  const root = input.root ?? adapterInstallRoot(input.entry || selfEntry())
  if (!root) return undefined

  const previous = readAdapterRecords(paths, [input.name]).adapters[input.name]
  if (previous?.container) return undefined
  const platform = hostPlatform()
  const script = input.entry ?? (input.root ? undefined : selfEntry())
  const entry = script ? runnableEntry(script) : undefined
  const binary = join(root, adapterBinaryName(input.name, platform))
  const native = !entry && existsSync(binary)
  if (!native && !entry) return undefined

  const now = (input.now ?? (() => new Date()))().toISOString()
  const pairedAt = input.paired ? pairedTime(input.args, previous?.pairedAt, now) : undefined
  const installArgs = sanitizeInstallArgs(input.args)
  const record: AdapterInstallRecord = {
    kind: input.name,
    version: input.version,
    platform,
    path: root,
    ...(entry && script ? { entry: basename(script), node: process.execPath } : {}),
    installedAt: previous?.installedAt ?? now,
    ...(pairedAt ? { pairedAt } : {}),
    ...(installArgs.length > 0
      ? { installArgs }
      : previous?.installArgs
        ? { installArgs: previous.installArgs }
        : {}),
  }

  let warning: string | undefined
  let link: { path: string; target: string } | undefined
  try {
    saveAdapterRecord(record, paths)
  } catch (cause) {
    warning = `Could not write the adapter record: ${describe(cause)}`
  }

  if (native) {
    try {
      link = linkBinary({
        source: binary,
        name: `clara-adapter-${input.name}`,
        binDir: defaultBinDir(env),
      })
    } catch (cause) {
      warning ??= `Could not link the adapter command: ${describe(cause)}`
    }
  }
  return { record, ...(link ? { link } : {}), ...(warning ? { warning } : {}) }
}

/**
 * Refresh the host record and launcher for an already installed adapter. The
 * daemon runs on every boot, so an install from an older CLI heals itself.
 */
export function ensureAdapterRecord(input: {
  name: string
  version: string
  paired: boolean
  entry?: string
  root?: string
  containerized?: boolean
  env?: NodeJS.ProcessEnv
}): AdapterRecordResult | undefined {
  return recordAdapterInstall({
    name: input.name,
    version: input.version,
    args: [],
    paired: input.paired,
    ...(input.entry ? { entry: input.entry } : {}),
    ...(input.root ? { root: input.root } : {}),
    ...(input.containerized !== undefined ? { containerized: input.containerized } : {}),
    ...(input.env ? { env: input.env } : {}),
  })
}

/** Remove the host record and launcher this install owns, never another copy. */
export function forgetAdapterInstall(name: string, env = process.env, rootOverride?: string): void {
  const paths = claraPaths(env)
  const root = rootOverride ?? adapterInstallRoot()
  const source = root ? join(root, adapterBinaryName(name, hostPlatform())) : undefined
  if (source) {
    try {
      removeBinaryLink({ name: `clara-adapter-${name}`, source, binDir: defaultBinDir(env) })
    } catch {
      // Best-effort cleanup.
    }
  }

  const record = readAdapterRecords(paths, [name]).adapters[name]
  if (!record || record.container) return
  if (record.path && root && resolve(record.path) !== resolve(root)) return
  try {
    deleteAdapterRecord(name, paths)
    if (root) rmSync(join(root, 'install.json'), { force: true })
  } catch {
    // Best-effort cleanup.
  }
}

function runnableEntry(script: string | undefined): string | undefined {
  if (!script || !/\.(?:[cm]?js)$/i.test(script)) return undefined
  return script
}

function pairedTime(args: readonly string[], previous: string | undefined, now: string): string {
  const explicit = args.some((arg) => arg === '--pair' || arg.startsWith('--pair='))
  return explicit ? now : (previous ?? now)
}

function hostPlatform(): string {
  try {
    return detectAdapterTarget()
  } catch {
    return `${process.platform}-${process.arch}`
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
