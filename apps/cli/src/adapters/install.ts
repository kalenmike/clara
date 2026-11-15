import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveFormat, extractArchive } from './archive.ts'
import { downloadVerified, type DownloadProgress } from './download.ts'
import { detectAdapterTarget, isAdapterTarget, type AdapterTarget } from './platform.ts'
import type { AdapterKind, AdapterRegistry } from './registry.ts'
import {
  deleteAdapterRecord,
  readAdapterState,
  saveAdapterRecord,
  type AdapterInstallRecord,
} from './state.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

export type BinaryResult = {
  code: number
  stderr: string
}

export type BinaryRunner = (command: string, args: readonly string[]) => Promise<BinaryResult>

export type ExtractRunner = (input: {
  archive: string
  dest: string
  format: 'tar.gz' | 'zip'
}) => void

export type InstallDeps = {
  registry: AdapterRegistry
  paths?: ClaraPaths
  now?: () => number
  onProgress?: DownloadProgress
  fetchImpl?: typeof fetch
  runBinary?: BinaryRunner
  extract?: ExtractRunner
  log?: (message: string) => void
  /** Called before a streaming child starts, so a spinner can get out of the way. */
  onPhase?: (phase: 'pairing' | 'starting' | 'stopping') => void
}

export type InstallRequest = {
  kind: AdapterKind
  /** Only the published version can be installed from the static registry. */
  version?: string
  target?: AdapterTarget
  pairCode?: string
  start?: boolean
  force?: boolean
}

export type UpgradeReport = {
  kind: AdapterKind
  from?: string
  to?: string
  changed: boolean
  error?: string
}

export function adapterBinaryName(kind: string, target: string): string {
  return `clara-adapter-${kind}${target.startsWith('win32') ? '.exe' : ''}`
}

export function adapterInstallDir(paths: ClaraPaths, kind: AdapterKind, version: string): string {
  return join(paths.dataDir, 'adapters', kind, version)
}

export function adapterBinaryPath(record: AdapterInstallRecord): string {
  return join(record.path, adapterBinaryName(record.kind, record.platform))
}

/** Pull, verify, extract, record, pair, and optionally start one adapter. */
export async function installAdapter(
  request: InstallRequest,
  deps: InstallDeps
): Promise<AdapterInstallRecord> {
  const paths = deps.paths ?? resolvePaths()
  const target = request.target ?? detectAdapterTarget()
  const manifest = await deps.registry.manifest(request.kind)
  if (request.version && request.version !== manifest.version) {
    throw new Error(
      `The registry only publishes ${request.kind} ${manifest.version}; ` +
        `${request.version} is not available.`
    )
  }
  const artifact = manifest.artifacts[target]
  if (!artifact) {
    throw new Error(
      `No ${request.kind} build is published for ${target}. ` +
        `Available: ${Object.keys(manifest.artifacts).join(', ') || '(none)'}.`
    )
  }

  const installDir = adapterInstallDir(paths, request.kind, manifest.version)
  const binary = join(installDir, adapterBinaryName(request.kind, target))
  const previous = readAdapterState(paths).adapters[request.kind]
  const existing = previous?.version === manifest.version && existsSync(binary)

  if (!existing || request.force) {
    await pullArtifact({ artifact, installDir, deps })
  }
  if (!existsSync(binary)) {
    throw new Error(
      `The ${request.kind} archive did not contain ${adapterBinaryName(request.kind, target)}.`
    )
  }
  if (process.platform !== 'win32') chmodSync(binary, 0o755)

  let record: AdapterInstallRecord = {
    kind: request.kind,
    version: manifest.version,
    platform: target,
    path: installDir,
    installedAt: previous?.installedAt ?? new Date((deps.now ?? Date.now)()).toISOString(),
    ...(previous?.pairedAt ? { pairedAt: previous.pairedAt } : {}),
  }
  saveAdapterRecord(record, paths)

  if (request.pairCode) {
    deps.onPhase?.('pairing')
    const result = await runAdapterBinary(deps, binary, ['install', '--pair', request.pairCode])
    if (result.code !== 0) {
      record = { ...record, lastError: failureText('install', result) }
      saveAdapterRecord(record, paths)
      throw new Error(`The ${request.kind} adapter install failed: ${record.lastError}`)
    }
    record = { ...record, pairedAt: new Date((deps.now ?? Date.now)()).toISOString() }
    saveAdapterRecord(record, paths)
  }

  if (request.start !== false) {
    deps.onPhase?.('starting')
    const result = await runAdapterBinary(deps, binary, ['start'])
    if (result.code !== 0) {
      record = { ...record, lastError: failureText('start', result) }
      saveAdapterRecord(record, paths)
      deps.log?.(`The adapter did not start: ${record.lastError}`)
    }
  }
  return record
}

/** Move one installed adapter to the version the registry publishes today. */
export async function upgradeAdapter(
  kind: AdapterKind,
  deps: InstallDeps,
  options: { target?: AdapterTarget; start?: boolean } = {}
): Promise<UpgradeReport> {
  const paths = deps.paths ?? resolvePaths()
  const record = readAdapterState(paths).adapters[kind]
  if (!record) throw new Error(`The ${kind} adapter is not installed.`)
  const manifest = await deps.registry.manifest(kind)
  if (record.version === manifest.version) {
    return { kind, from: record.version, to: record.version, changed: false }
  }
  const target = options.target ?? (isAdapterTarget(record.platform) ? record.platform : undefined)
  const binary = adapterBinaryPath(record)
  if (existsSync(binary)) {
    deps.onPhase?.('stopping')
    await runAdapterBinary(deps, binary, ['stop'])
  }
  const next = await installAdapter(
    {
      kind,
      target: target ?? detectAdapterTarget(),
      force: true,
      ...(options.start !== undefined ? { start: options.start } : {}),
    },
    deps
  )
  return { kind, from: record.version, to: next.version, changed: true }
}

/** Stop and uninstall an adapter, then delete its downloaded versions. */
export async function removeAdapter(
  kind: AdapterKind,
  deps: InstallDeps,
  options: { purge?: boolean } = {}
): Promise<string[]> {
  const paths = deps.paths ?? resolvePaths()
  const record = readAdapterState(paths).adapters[kind]
  if (!record) throw new Error(`The ${kind} adapter is not installed.`)

  const actions: string[] = []
  const binary = adapterBinaryPath(record)
  if (existsSync(binary)) {
    const stopped = await runAdapterBinary(deps, binary, ['stop'])
    if (stopped.code === 0) actions.push('stop the adapter process')
    const args = options.purge ? ['uninstall', '--purge'] : ['uninstall']
    const removed = await runAdapterBinary(deps, binary, args)
    if (removed.code === 0) {
      actions.push(
        options.purge
          ? 'remove the adapter config, service, and credentials'
          : 'remove the adapter config and service'
      )
    } else {
      actions.push(failureText('uninstall', removed))
    }
  }

  rmSync(join(paths.dataDir, 'adapters', kind), { recursive: true, force: true })
  deleteAdapterRecord(kind, paths)
  actions.push(`remove ${record.path}`)
  return actions
}

/** Run the installed adapter's own subcommands (`start`, `stop`, `status`, `logs`). */
export async function runAdapterBinary(
  deps: InstallDeps,
  binary: string,
  args: readonly string[]
): Promise<BinaryResult> {
  return (deps.runBinary ?? runStreamed)(binary, args)
}

/** Stream a child's output to this terminal and keep the stderr tail. */
export function runStreamed(command: string, args: readonly string[]): Promise<BinaryResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      if (stderr.length < 4_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (cause) => resolve({ code: 1, stderr: cause.message }))
    child.on('exit', (code) => resolve({ code: code ?? 1, stderr: tail(stderr) }))
  })
}

async function pullArtifact(input: {
  artifact: { url: string; sha256: string; size?: number }
  installDir: string
  deps: InstallDeps
}): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'clara-adapter-'))
  try {
    const archive = join(temp, 'artifact')
    await downloadVerified({
      url: input.artifact.url,
      destination: archive,
      sha256: input.artifact.sha256,
      ...(input.artifact.size !== undefined ? { size: input.artifact.size } : {}),
      ...(input.deps.fetchImpl ? { fetchImpl: input.deps.fetchImpl } : {}),
      ...(input.deps.onProgress ? { onProgress: input.deps.onProgress } : {}),
    })

    rmSync(input.installDir, { recursive: true, force: true })
    mkdirSync(input.installDir, { recursive: true, mode: 0o700 })
    chmodSync(input.installDir, 0o700)
    try {
      const extract = input.deps.extract ?? extractArchive
      extract({ archive, dest: input.installDir, format: archiveFormat(input.artifact.url) })
    } catch (cause) {
      rmSync(input.installDir, { recursive: true, force: true })
      throw cause
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function failureText(action: string, result: BinaryResult): string {
  return result.stderr.trim() || `the ${action} command exited with code ${result.code}`
}

function tail(text: string): string {
  return text.length > 4_000 ? text.slice(-4_000) : text
}
