import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { archiveFormat, extractArchive } from '@clara/adapter-artifact'
import {
  containerRuntimeState,
  inspectContainer,
  readContainerStatus,
  runDocker,
  startContainer,
  stopContainer,
  type DockerRunner,
} from './container.ts'
import {
  detectAdapterTarget,
  downloadVerified,
  isAdapterTarget,
  type AdapterTarget,
  type DownloadProgress,
} from '@clara/adapter-artifact'
import { defaultBinDir, removeBinaryLink } from '@clara/release'
import type { AdapterKind, AdapterRegistry } from './registry.ts'
import {
  adapterEnv,
  deleteAdapterRecord,
  readAdapterRecords,
  saveAdapterRecord,
  type AdapterInstallRecord,
} from './state.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

/** Enough help text to find a flag; the adapters print a page at most. */
const STDOUT_LIMIT = 64_000

export type BinaryResult = {
  code: number
  stderr: string
  /** Captured only when the runner was asked to capture output. */
  stdout?: string
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
  /** Runs Docker commands for a container-backed adapter. */
  docker?: DockerRunner
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
  /** Stage a built adapter package or `dist` directory instead of a registry archive. */
  from?: string
  /** Install into, or adopt, an adapter that runs in this Docker container. */
  container?: string
  /** Reinstall with the saved pairing instead of enrolling a new adapter. */
  reusePairing?: boolean
  /** Adapter install flags replayed when the adapter is reinstalled. */
  installArgs?: string[]
}

export type UpgradeReport = {
  kind: AdapterKind
  from?: string
  to?: string
  changed: boolean
  /** The install reran at the same version. */
  reinstalled?: boolean
  error?: string
}

export function adapterBinaryName(kind: string, target: string): string {
  return `clara-adapter-${kind}${target.startsWith('win32') ? '.exe' : ''}`
}

export function adapterInstallDir(paths: ClaraPaths, kind: AdapterKind, version: string): string {
  return join(paths.dataDir, 'adapters', kind, version)
}

export function adapterBinaryPath(record: AdapterInstallRecord): string {
  return join(hostInstallPath(record), adapterBinaryName(record.kind, record.platform))
}

/** The file a record executes, whether a native binary or a staged JS entry. */
export function adapterEntryPath(record: AdapterInstallRecord): string {
  return record.entry ? join(hostInstallPath(record), record.entry) : adapterBinaryPath(record)
}

/** The command that runs an installed adapter. */
export function adapterCommand(record: AdapterInstallRecord): AdapterCommand {
  if (record.container) {
    throw new Error(
      `The ${record.kind} adapter runs in container ${record.container.name}; use the Docker commands.`
    )
  }
  if (record.entry) {
    return {
      command: record.node ?? process.execPath,
      args: [join(hostInstallPath(record), record.entry)],
    }
  }
  return { command: adapterBinaryPath(record), args: [] }
}

/** A container record has no host entry, so name the reason instead of a blank path. */
function hostInstallPath(record: AdapterInstallRecord): string {
  if (record.path) return record.path
  const where = record.container ? `container ${record.container.name}` : 'another host'
  throw new Error(`The ${record.kind} adapter runs in ${where}; it has no host install path.`)
}

export type AdapterCommand = {
  command: string
  args: string[]
}

/** Stage an adapter, record it, pair it, and optionally start it. */
export async function installAdapter(
  request: InstallRequest,
  deps: InstallDeps
): Promise<AdapterInstallRecord> {
  const paths = deps.paths ?? resolvePaths()
  if (request.container) return installContainerAdapter(request, paths, deps)
  const target = request.target ?? detectAdapterTarget()
  const previous = readAdapterRecords(paths).adapters[request.kind]
  const staged = request.from
    ? stageLocalAdapter(request, paths, target, previous, deps)
    : await pullAdapter(request, paths, target, previous, deps)

  let record: AdapterInstallRecord = {
    ...staged,
    ...(request.installArgs && request.installArgs.length > 0
      ? { installArgs: request.installArgs }
      : previous?.installArgs
        ? { installArgs: previous.installArgs }
        : {}),
  }
  const command = adapterCommand(record)

  if (!request.pairCode && request.reusePairing) {
    // `--reuse-pairing` is part of the adapter contract, not the archive. An
    // adapter from an older registry ignores the flag and falls back to the
    // interactive pairing path, which fails silently in a non-interactive
    // install. Refuse before recording a half-installed version.
    const supported = await adapterSupportsReusePairing(deps, command, request.kind)
    if (supported === false) {
      throw new Error(
        `The ${request.kind} adapter ${record.version} cannot reinstall from its saved pairing. ` +
          `Install it with a new pairing code: clara adapter install ${request.kind} --pair <code>`
      )
    }
  }

  saveAdapterRecord(record, paths)
  const provenanceEnv = installProvenanceEnv(deps, record, request)

  if (request.pairCode) {
    deps.onPhase?.('pairing')
    const result = await runAdapterCommand(
      deps,
      command,
      ['install', '--pair', request.pairCode, ...(record.installArgs ?? [])],
      request.kind,
      { env: provenanceEnv }
    )
    if (result.code !== 0) {
      record = { ...record, lastError: failureText('install', result) }
      saveAdapterRecord(record, paths)
      throw new Error(`The ${request.kind} adapter install failed: ${record.lastError}`)
    }
    record = { ...record, pairedAt: new Date((deps.now ?? Date.now)()).toISOString() }
    saveAdapterRecord(record, paths)
  } else if (request.reusePairing) {
    deps.onPhase?.('pairing')
    const result = await runAdapterCommand(
      deps,
      command,
      ['install', '--reuse-pairing', ...(record.installArgs ?? [])],
      request.kind,
      { env: provenanceEnv }
    )
    if (result.code !== 0) {
      record = { ...record, lastError: failureText('reinstall', result) }
      saveAdapterRecord(record, paths)
      throw new Error(`The ${request.kind} adapter reinstall failed: ${record.lastError}`)
    }
  }

  if (request.start !== false) {
    deps.onPhase?.('starting')
    const result = await runAdapterCommand(deps, command, ['start'], request.kind)
    if (result.code !== 0) {
      record = { ...record, lastError: failureText('start', result) }
      saveAdapterRecord(record, paths)
      deps.log?.(`The adapter did not start: ${record.lastError}`)
    }
  }
  return record
}

/** Tell a freshly staged adapter its version and where it came from. */
function installProvenanceEnv(
  deps: InstallDeps,
  record: AdapterInstallRecord,
  request: InstallRequest
): NodeJS.ProcessEnv {
  return {
    CLARA_ADAPTER_VERSION: record.version,
    ...(request.from
      ? { CLARA_ADAPTER_SOURCE: 'local' }
      : { CLARA_ADAPTER_REGISTRY_URL: deps.registry.baseUrl() }),
  }
}

/**
 * A container owns the adapter process and its pairing config. The host command
 * records the container so `status`, `start`, `stop`, and `logs` can reach it,
 * and never writes a pid or a host install path.
 */
async function installContainerAdapter(
  request: InstallRequest,
  paths: ClaraPaths,
  deps: InstallDeps
): Promise<AdapterInstallRecord> {
  const name = request.container?.trim()
  if (!name) throw new Error('--container needs a container name.')
  const docker = deps.docker ?? runDocker
  const info = inspectContainer(name, docker)
  const previous = readAdapterRecords(paths).adapters[request.kind]
  const now = () => new Date((deps.now ?? Date.now)()).toISOString()

  if (request.pairCode) {
    if (!info.running) {
      throw new Error(
        `Container ${name} is stopped. Pair it with the container's install command, then ` +
          `record it with: clara adapter install ${request.kind} --container ${name}`
      )
    }
    deps.onPhase?.('pairing')
    const args = ['install', '--pair', request.pairCode, ...(request.installArgs ?? [])]
    const result = docker(['exec', name, ...info.entry, ...args])
    if (result.code !== 0) {
      throw new Error(
        `The ${request.kind} adapter install failed: ${failureText('install', result)}`
      )
    }
  }

  const status = readContainerStatus(info, docker)
  if (!request.pairCode && !status.paired) {
    throw new Error(
      `The ${request.kind} adapter in container ${name} is not paired. ` +
        'Pair it with --pair <code>, or run the installer inside the container.'
    )
  }

  let record: AdapterInstallRecord = {
    kind: request.kind,
    version: status.version ?? previous?.version ?? 'unknown',
    platform: previous?.platform ?? hostPlatform(),
    container: {
      name,
      entry: [...info.entry],
      ...(info.configDir ? { configDir: info.configDir } : {}),
      ...(info.dataDir ? { dataDir: info.dataDir } : {}),
      ...(info.compose ? { compose: info.compose } : {}),
    },
    installedAt: previous?.installedAt ?? now(),
    ...(request.installArgs && request.installArgs.length > 0
      ? { installArgs: request.installArgs }
      : previous?.installArgs
        ? { installArgs: previous.installArgs }
        : {}),
    ...(status.paired ? { pairedAt: previous?.pairedAt ?? now() } : {}),
  }
  saveAdapterRecord(record, paths)

  if (request.start !== false && !info.running) {
    deps.onPhase?.('starting')
    const started = startContainer(name, docker)
    if (started.code !== 0) {
      record = { ...record, lastError: failureText('start', started) }
      saveAdapterRecord(record, paths)
      deps.log?.(`The adapter container did not start: ${record.lastError}`)
    }
  }
  return record
}

function hostPlatform(): string {
  try {
    return detectAdapterTarget()
  } catch {
    return `${process.platform}-${process.arch}`
  }
}

async function pullAdapter(
  request: InstallRequest,
  paths: ClaraPaths,
  target: AdapterTarget,
  previous: AdapterInstallRecord | undefined,
  deps: InstallDeps
): Promise<AdapterInstallRecord> {
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

  return {
    kind: request.kind,
    version: manifest.version,
    platform: target,
    path: installDir,
    installedAt: previous?.installedAt ?? new Date((deps.now ?? Date.now)()).toISOString(),
    ...(previous?.pairedAt ? { pairedAt: previous.pairedAt } : {}),
  }
}

type LocalAdapterSource = {
  root: string
  dist: string
}

export function resolveLocalAdapterSource(input: string, kind: AdapterKind): LocalAdapterSource {
  // `pnpm cli` runs the command from apps/cli; resolve relative paths from the
  // directory the caller invoked it in.
  const base = process.env.INIT_CWD?.trim() || process.cwd()
  const path = resolve(base, input)
  const candidates: LocalAdapterSource[] = [
    { root: path, dist: join(path, 'dist') },
    { root: dirname(path), dist: path },
  ]
  for (const candidate of candidates) {
    if (!existsSync(join(candidate.dist, 'index.js'))) continue
    const pkg = readAdapterPackage(candidate.root)
    if (pkg?.name && pkg.name !== `@clara/adapter-${kind}`) {
      throw new Error(
        `The package at ${candidate.root} is ${pkg.name}, not @clara/adapter-${kind}.`
      )
    }
    return candidate
  }
  throw new Error(
    `No built ${kind} adapter at ${path}. Pass a package directory or its dist directory ` +
      'after building the adapter.'
  )
}

function stageLocalAdapter(
  request: InstallRequest,
  paths: ClaraPaths,
  target: AdapterTarget,
  previous: AdapterInstallRecord | undefined,
  deps: InstallDeps
): AdapterInstallRecord {
  const source = resolveLocalAdapterSource(request.from ?? '', request.kind)
  const version = request.version ?? localAdapterVersion(source.root)
  const installDir = adapterInstallDir(paths, request.kind, version)
  const staged = join(installDir, 'index.js')
  // A local build can change without its commit changing; always refresh the
  // staged copy so `--from` runs the code that was just built.
  rmSync(installDir, { recursive: true, force: true })
  mkdirSync(installDir, { recursive: true })
  cpSync(source.dist, installDir, { recursive: true })
  // The Node build keeps its non-workspace dependencies external. Link the
  // package's modules so the staged entry resolves them from the checkout.
  const modules = join(source.root, 'node_modules')
  if (existsSync(modules)) {
    symlinkSync(
      modules,
      join(installDir, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
  }
  if (!existsSync(staged)) {
    throw new Error(
      `The ${request.kind} build has no dist/index.js at ${source.dist}. Build the adapter first.`
    )
  }
  return {
    kind: request.kind,
    version,
    platform: target,
    path: installDir,
    entry: 'index.js',
    node: nodeExecutable(),
    installedAt: previous?.installedAt ?? new Date((deps.now ?? Date.now)()).toISOString(),
    ...(previous?.pairedAt ? { pairedAt: previous.pairedAt } : {}),
  }
}

/**
 * The packaged command is a Bun binary; a checkout adapter is a Node build.
 * Persist the Node path so a later `clara` run uses it instead of Bun.
 */
export function nodeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_NODE_BIN?.trim()
  if (configured) return configured
  if (!process.versions.bun) return process.execPath
  const result = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' })
  const resolved = result.status === 0 ? String(result.stdout).trim() : ''
  if (resolved) return resolved
  throw new Error(
    'Installing a checkout adapter build needs Node. Run `pnpm cli` or set CLARA_NODE_BIN.'
  )
}

function readAdapterPackage(root: string): { name?: string; version?: string } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    return {
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
    }
  } catch {
    return undefined
  }
}

function localAdapterVersion(root: string): string {
  const version = readAdapterPackage(root)?.version ?? '0.0.0'
  const result = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  })
  const commit = result.status === 0 ? String(result.stdout).trim() : ''
  return `${version}-dev+${commit || Date.now().toString(36)}`
}

/** Move one installed adapter to the version the registry publishes today. */
export async function upgradeAdapter(
  kind: AdapterKind,
  deps: InstallDeps,
  options: { target?: AdapterTarget; start?: boolean } = {}
): Promise<UpgradeReport> {
  const paths = deps.paths ?? resolvePaths()
  const record = readAdapterRecords(paths).adapters[kind]
  if (!record) throw new Error(`The ${kind} adapter is not installed.`)
  if (record.container) {
    throw new Error(
      `The ${kind} adapter runs in container ${record.container.name}. ` +
        'Rebuild and recreate the container to upgrade it.'
    )
  }
  // Fail before stopping the adapter when the registry is unreachable.
  await deps.registry.manifest(kind)
  const target = options.target ?? (isAdapterTarget(record.platform) ? record.platform : undefined)
  if (existsSync(adapterEntryPath(record))) {
    deps.onPhase?.('stopping')
    await runAdapterCommand(deps, adapterCommand(record), ['stop'], kind)
  }
  const next = await installAdapter(
    {
      kind,
      target: target ?? detectAdapterTarget(),
      force: true,
      reusePairing: true,
      ...(record.installArgs ? { installArgs: record.installArgs } : {}),
      ...(options.start !== undefined ? { start: options.start } : {}),
    },
    deps
  )
  const changed = record.version !== next.version
  return {
    kind,
    from: record.version,
    to: next.version,
    changed,
    ...(changed ? {} : { reinstalled: true }),
  }
}

/** Stop and uninstall an adapter, then delete its downloaded versions. */
export async function removeAdapter(
  kind: AdapterKind,
  deps: InstallDeps,
  options: { purge?: boolean } = {}
): Promise<string[]> {
  const paths = deps.paths ?? resolvePaths()
  const record = readAdapterRecords(paths).adapters[kind]
  if (!record) throw new Error(`The ${kind} adapter is not installed.`)
  if (record.container) return removeContainerAdapter(record, deps, paths)

  const actions: string[] = []
  const command = adapterCommand(record)
  if (existsSync(adapterEntryPath(record))) {
    const stopped = await runAdapterCommand(deps, command, ['stop'], kind)
    if (stopped.code === 0) actions.push('stop the adapter process')
    const args = options.purge ? ['uninstall', '--purge'] : ['uninstall']
    const removed = await runAdapterCommand(deps, command, args, kind)
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
  if (record.path) {
    removeBinaryLink({
      name: `clara-adapter-${kind}`,
      source: join(record.path, adapterBinaryName(kind, record.platform)),
      binDir: defaultBinDir(),
    })
  }
  actions.push(`remove ${record.path}`)
  return actions
}

/**
 * Docker owns the container and its volumes, so removing a container record
 * stops the container and forgets it here. It never deletes data Clara did not
 * create through the host command.
 */
function removeContainerAdapter(
  record: AdapterInstallRecord,
  deps: InstallDeps,
  paths: ClaraPaths
): string[] {
  const container = record.container
  if (!container) return []
  const docker = deps.docker ?? runDocker
  const actions: string[] = []
  if (containerRuntimeState(container.name, docker) === 'running') {
    const stopped = stopContainer(container.name, docker)
    actions.push(stopped.code === 0 ? 'stop the adapter container' : failureText('stop', stopped))
  }
  deleteAdapterRecord(record.kind, paths)
  actions.push('remove the adapter install record')
  const compose = container.compose?.service
    ? ` (compose service ${container.compose.service})`
    : ''
  actions.push(`the container ${container.name}${compose} and its volumes were left in place`)
  return actions
}

export type AdapterRunDeps = {
  paths?: ClaraPaths
  runBinary?: BinaryRunner
}

/** Run the installed adapter's own subcommands (`start`, `stop`, `status`, `logs`). */
export async function runAdapterBinary(
  deps: AdapterRunDeps,
  binary: string,
  args: readonly string[],
  kind?: AdapterKind,
  options: RunOptions = {}
): Promise<BinaryResult> {
  const paths = deps.paths ?? resolvePaths()
  const env = kind
    ? { ...adapterEnv(paths, kind), ...options.env }
    : { ...process.env, ...options.env }
  return (deps.runBinary ?? ((command, list) => runStreamed(command, list, env, options)))(
    binary,
    args
  )
}

/** Run an installed adapter through its recorded command. */
export async function runAdapterCommand(
  deps: AdapterRunDeps,
  command: AdapterCommand,
  args: readonly string[],
  kind?: AdapterKind,
  options: RunOptions = {}
): Promise<BinaryResult> {
  return runAdapterBinary(deps, command.command, [...command.args, ...args], kind, options)
}

export type RunOptions = {
  /** Keep the child's output out of the terminal and return stdout instead. */
  capture?: boolean
  /** Extra environment for the adapter child, merged over its data paths. */
  env?: NodeJS.ProcessEnv
}

/**
 * Whether the installed adapter understands `install --reuse-pairing`.
 * `undefined` means the probe could not decide (the binary did not run, or an
 * injected runner returned no stdout), so the caller proceeds and lets the
 * adapter report its own error.
 */
export async function adapterSupportsReusePairing(
  deps: AdapterRunDeps,
  command: AdapterCommand,
  kind: AdapterKind
): Promise<boolean | undefined> {
  const result = await runAdapterCommand(deps, command, ['install', '--help'], kind, {
    capture: true,
  })
  if (result.code !== 0 || typeof result.stdout !== 'string') return undefined
  return result.stdout.includes('--reuse-pairing')
}

/** Stream a child's output to this terminal and keep the stderr tail. */
export function runStreamed(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  options: RunOptions = {}
): Promise<BinaryResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      if (options.capture) {
        if (stdout.length < STDOUT_LIMIT) stdout += chunk.toString('utf8')
        return
      }
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!options.capture) process.stderr.write(chunk)
      if (stderr.length < 4_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (cause) => resolve({ code: 1, stderr: cause.message }))
    child.on('exit', (code) =>
      resolve({
        code: code ?? 1,
        stderr: tail(stderr),
        ...(options.capture ? { stdout: tail(stdout, STDOUT_LIMIT) } : {}),
      })
    )
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

function tail(text: string, limit = 4_000): string {
  return text.length > limit ? text.slice(-limit) : text
}
