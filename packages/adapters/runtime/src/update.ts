import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Hono } from 'hono'
import {
  adapterBinaryName,
  archiveFormat,
  compareVersions,
  detectAdapterTarget,
  downloadVerified,
  extractArchive,
  isAdapterVersion,
  readAdapterProvenance,
  type AdapterTarget,
} from '@clara/adapter-artifact'
import { jsonBody } from './http.ts'
import { adapterInstallRoot } from './provenance.ts'
import {
  adapterProcessAlive,
  adapterServiceKind,
  removeAdapterService,
  restoreAdapterService,
  selfCommand,
  selfEntry,
  snapshotAdapterService,
  stopAdapter,
} from './service.ts'
import { readState } from './state.ts'
import type { AdapterPaths } from './types.ts'

const MANIFEST_TIMEOUT_MS = 20_000
const MAX_MANIFEST_BYTES = 512 * 1024
const RESTART_DELAY_MS = 750
const STOP_TIMEOUT_MS = 10_000
const AUTH_TIMEOUT_MS = 90_000
const ROLLBACK_TIMEOUT_MS = 60_000
const BUSY_WINDOW_MS = 10 * 60_000
const SHA256 = /^[a-f0-9]{64}$/i

export type AdapterUpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'staged'
  | 'restarting'
  | 'succeeded'
  | 'failed'
  | 'rolled-back'

export type AdapterUpdateStatus = {
  schemaVersion: 1
  state: AdapterUpdateState
  from?: string
  to?: string
  startedAt: string
  updatedAt: string
  error?: string
  rolledBack?: boolean
}

type AdapterManifest = {
  schemaVersion: 1
  harness: string
  version: string
  artifacts: Record<string, { url: string; sha256: string; size?: number }>
}

type AdapterUpdatePlan = {
  schemaVersion: 1
  kind: string
  label: string
  from: string
  to: string
  platform: string
  oldRoot: string
  newRoot: string
  registryUrl: string
  installArgs: string[]
  pid: number
  startedAt: string
}

export type AdapterUpdateTarget = {
  kind: string
  label: string
  version: string
  paths: AdapterPaths
  containerized: boolean
  /** The install directory; defaults to the running adapter's directory. */
  root?: string
  platform?: AdapterTarget
  fetchImpl?: typeof fetch
  /** Start the restart supervisor; injected by tests that only stage. */
  supervise?: (paths: AdapterPaths, planPath: string, kind: string) => void
}

export class AdapterUpdateError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AdapterUpdateError'
    this.status = status
    this.code = code
  }
}

export function adapterUpdateStatusPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'update.json')
}

export function readAdapterUpdateStatus(paths: AdapterPaths): AdapterUpdateStatus {
  const path = adapterUpdateStatusPath(paths)
  if (!existsSync(path)) return idleUpdateStatus()
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterUpdateStatus>
    if (value.schemaVersion !== 1 || typeof value.state !== 'string') {
      return idleUpdateStatus()
    }
    return {
      schemaVersion: 1,
      state: value.state as AdapterUpdateState,
      ...(typeof value.from === 'string' ? { from: value.from } : {}),
      ...(typeof value.to === 'string' ? { to: value.to } : {}),
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(value.rolledBack === true ? { rolledBack: true } : {}),
    }
  } catch {
    return idleUpdateStatus()
  }
}

function idleUpdateStatus(): AdapterUpdateStatus {
  const now = new Date().toISOString()
  return { schemaVersion: 1, state: 'idle', startedAt: now, updatedAt: now }
}

/** Register the adapter's own maintenance surface. */
export function registerAdapterUpdateRoutes(app: Hono, options: AdapterUpdateTarget): void {
  app.get('/harness/v1/maintenance/update', (c) => c.json(readAdapterUpdateStatus(options.paths)))
  app.post('/harness/v1/maintenance/update', async (c) => {
    const body = await jsonBody<{ version?: unknown }>(c)
    if (body.version !== undefined && typeof body.version !== 'string') {
      return c.json(
        { error: { code: 'invalid_request', message: 'The update version must be a string' } },
        400
      )
    }
    try {
      const result = await stageAdapterUpdate(options, body.version)
      return c.json({ accepted: true, ...result }, 202)
    } catch (cause) {
      if (cause instanceof AdapterUpdateError) {
        return c.json({ error: { code: cause.code, message: cause.message } }, cause.status as 400)
      }
      return c.json(
        {
          error: {
            code: 'update_failed',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        },
        500
      )
    }
  })
}

/**
 * Check the pinned registry, stage the newer build, and hand the restart to a
 * detached supervisor. The old adapter keeps running until every byte has been
 * verified and extracted.
 */
export async function stageAdapterUpdate(
  target: AdapterUpdateTarget,
  requestedVersion?: string
): Promise<{ from: string; to: string }> {
  const root = target.root ?? adapterInstallRoot()
  if (!root) {
    throw new AdapterUpdateError(
      409,
      'update_unavailable',
      'This adapter has no install directory to update.'
    )
  }
  if (target.containerized) {
    throw new AdapterUpdateError(
      409,
      'container_adapter',
      'This adapter runs in a container. Rebuild and recreate the container to upgrade it.'
    )
  }
  const provenance = readAdapterProvenance(root)
  if (!provenance || provenance.source !== 'registry' || !provenance.registryUrl) {
    throw new AdapterUpdateError(
      409,
      'update_unavailable',
      'This adapter has no recorded registry. Reinstall it with the current command to enable remote updates.'
    )
  }
  const currentStatus = readAdapterUpdateStatus(target.paths)
  if (
    ['checking', 'downloading', 'staged', 'restarting'].includes(currentStatus.state) &&
    Date.now() - Date.parse(currentStatus.updatedAt) < BUSY_WINDOW_MS
  ) {
    throw new AdapterUpdateError(409, 'update_busy', 'An adapter update is already in progress.')
  }

  const startedAt = new Date().toISOString()
  writeAdapterUpdateStatus(target.paths, {
    schemaVersion: 1,
    state: 'checking',
    from: target.version,
    startedAt,
  })

  let staging: string | undefined
  let archive: string | undefined
  try {
    const platform = target.platform ?? detectAdapterTarget()
    const manifest = await fetchManifest(provenance.registryUrl, target.kind, target.fetchImpl)
    if (requestedVersion && requestedVersion !== manifest.version) {
      throw new AdapterUpdateError(
        409,
        'version_mismatch',
        `The adapter's registry publishes ${manifest.version}, not ${requestedVersion}.`
      )
    }
    if (compareVersions(manifest.version, target.version) <= 0) {
      throw new AdapterUpdateError(
        409,
        'already_current',
        `The adapter already runs ${target.version}.`
      )
    }
    const artifact = manifest.artifacts[platform]
    if (!artifact) {
      throw new AdapterUpdateError(
        409,
        'update_unsupported',
        `No ${manifest.version} build is published for ${platform}.`
      )
    }
    if (!allowedArtifactUrl(artifact.url)) {
      throw new AdapterUpdateError(
        409,
        'update_unavailable',
        'The adapter registry returned an insecure artifact URL.'
      )
    }
    if (!SHA256.test(artifact.sha256)) {
      throw new AdapterUpdateError(
        409,
        'update_unavailable',
        'The adapter registry returned an invalid artifact digest.'
      )
    }

    const base = dirname(root)
    const newRoot = join(base, manifest.version)
    if (newRoot === root || !isAdapterVersion(manifest.version)) {
      throw new AdapterUpdateError(409, 'update_invalid', 'The published version is invalid.')
    }

    writeAdapterUpdateStatus(target.paths, {
      schemaVersion: 1,
      state: 'downloading',
      from: target.version,
      to: manifest.version,
      startedAt,
    })
    staging = mkdtempSync(join(base, '.update-'))
    archive = join(tmpdir(), `clara-adapter-update-${process.pid}-${Date.now()}`)
    await downloadVerified({
      url: artifact.url,
      destination: archive,
      sha256: artifact.sha256,
      ...(artifact.size !== undefined ? { size: artifact.size } : {}),
      ...(target.fetchImpl ? { fetchImpl: target.fetchImpl } : {}),
    })
    extractArchive({ archive, dest: staging, format: archiveFormat(artifact.url) })
    const binary = join(staging, adapterBinaryName(target.kind, platform))
    if (!existsSync(binary)) {
      throw new AdapterUpdateError(
        409,
        'update_invalid',
        `The adapter archive did not contain ${adapterBinaryName(target.kind, platform)}.`
      )
    }
    if (process.platform !== 'win32') chmodSync(binary, 0o755)

    rmSync(newRoot, { recursive: true, force: true })
    renameSync(staging, newRoot)
    staging = undefined

    const plan: AdapterUpdatePlan = {
      schemaVersion: 1,
      kind: target.kind,
      label: target.label,
      from: target.version,
      to: manifest.version,
      platform,
      oldRoot: root,
      newRoot,
      registryUrl: provenance.registryUrl,
      installArgs: provenance.installArgs ?? [],
      pid: process.pid,
      startedAt,
    }
    const planPath = adapterUpdatePlanPath(target.paths)
    writeJson(planPath, plan)
    writeAdapterUpdateStatus(target.paths, {
      schemaVersion: 1,
      state: 'staged',
      from: target.version,
      to: manifest.version,
      startedAt,
    })

    if (target.supervise) target.supervise(target.paths, planPath, target.kind)
    else startUpdateSupervisor(target.paths, planPath, target.kind)
    writeAdapterUpdateStatus(target.paths, {
      schemaVersion: 1,
      state: 'restarting',
      from: target.version,
      to: manifest.version,
      startedAt,
    })
    return { from: target.version, to: manifest.version }
  } catch (cause) {
    writeAdapterUpdateStatus(target.paths, {
      schemaVersion: 1,
      state: 'failed',
      from: target.version,
      startedAt,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    throw cause
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true })
    if (archive) rmSync(archive, { force: true })
  }
}

/** The detached supervisor: stop, reinstall, verify, or roll back. */
export async function applyAdapterUpdate(
  definition: { kind: string; label: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const planPath = argValue(args, '--plan')
  if (!planPath) throw new Error('apply-update needs --plan <path>')
  const plan = readPlan(planPath)
  await sleep(RESTART_DELAY_MS)

  const statusBase = {
    schemaVersion: 1 as const,
    from: plan.from,
    to: plan.to,
    startedAt: plan.startedAt,
  }
  const write = (state: AdapterUpdateState, error?: string) =>
    writeAdapterUpdateStatus(definition.paths, {
      ...statusBase,
      state,
      ...(error ? { error } : {}),
    })

  console.log(`Clara adapter update ${plan.from} -> ${plan.to}`)
  write('restarting')
  const snapshot = snapshotAdapterService(plan.kind)
  try {
    for (const action of stopAdapter(plan.kind, definition.paths)) console.log(action)
    await waitForExit(plan.pid, STOP_TIMEOUT_MS)
    if (adapterProcessAlive(plan.pid)) {
      try {
        process.kill(plan.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }

    const binary = join(plan.newRoot, adapterBinaryName(plan.kind, plan.platform))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLARA_ADAPTER_VERSION: plan.to,
      CLARA_ADAPTER_REGISTRY_URL: plan.registryUrl,
      CLARA_ADAPTER_SOURCE: 'registry',
    }
    const installed = run(binary, ['install', '--reuse-pairing', ...plan.installArgs], env)
    if (installed.status !== 0) {
      await rollback(definition, plan, snapshot, write, 'The new adapter install failed.')
      return
    }
    const started = run(binary, ['start'], env)
    if (started.status !== 0) {
      await rollback(definition, plan, snapshot, write, 'The new adapter did not start.')
      return
    }
    if (!(await waitForAuthentication(definition.paths, plan.pid, AUTH_TIMEOUT_MS))) {
      await rollback(definition, plan, snapshot, write, 'The new adapter did not authenticate.')
      return
    }
    write('succeeded')
    rmSync(planPath, { force: true })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    write('failed', message)
    console.error(message)
  }
}

async function rollback(
  definition: { kind: string; label: string; paths: AdapterPaths },
  plan: AdapterUpdatePlan,
  snapshot: ReturnType<typeof snapshotAdapterService>,
  write: (state: AdapterUpdateState, error?: string) => void,
  reason: string
): Promise<void> {
  console.error(reason)
  for (const action of stopAdapter(definition.kind, definition.paths)) console.log(action)
  if (snapshot.kind === 'none') {
    for (const action of removeAdapterService({
      name: definition.kind,
      label: definition.label,
      entry: selfEntry(),
      paths: definition.paths,
    })) {
      console.log(action)
    }
  } else {
    for (const action of restoreAdapterService(definition.kind, snapshot)) console.log(action)
  }
  const oldBinary = join(plan.oldRoot, adapterBinaryName(plan.kind, plan.platform))
  run(oldBinary, ['start'], process.env)
  const restored = await waitForAuthentication(definition.paths, plan.pid, ROLLBACK_TIMEOUT_MS)
  write(
    restored ? 'rolled-back' : 'failed',
    restored ? reason : `${reason} Rollback did not authenticate.`
  )
}

function startUpdateSupervisor(paths: AdapterPaths, planPath: string, kind: string): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  const logPath = join(paths.dataDir, 'update.log')
  const log = openSync(logPath, 'a', 0o600)
  const args = selfCommand(selfEntry(), 'apply-update', ['--plan', planPath])
  try {
    // A systemd user service kills its whole cgroup on stop. Run the supervisor
    // as a transient unit so it survives the old adapter's shutdown.
    if (process.platform === 'linux' && adapterServiceKind(kind) === 'systemd') {
      const envArgs = [
        ...(process.env.CLARA_ADAPTER_CONFIG_DIR
          ? [`--setenv=CLARA_ADAPTER_CONFIG_DIR=${process.env.CLARA_ADAPTER_CONFIG_DIR}`]
          : []),
        ...(process.env.CLARA_ADAPTER_DATA_DIR
          ? [`--setenv=CLARA_ADAPTER_DATA_DIR=${process.env.CLARA_ADAPTER_DATA_DIR}`]
          : []),
      ]
      const result = spawnSync(
        'systemd-run',
        [
          '--user',
          '--collect',
          '--quiet',
          `--property=StandardOutput=append:${logPath}`,
          `--property=StandardError=append:${logPath}`,
          ...envArgs,
          '--',
          process.execPath,
          ...args,
        ],
        { stdio: 'ignore', env: process.env, windowsHide: true }
      )
      if (result.status === 0) return
      console.error('systemd-run could not start the update supervisor; falling back')
    }
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', log, log],
      env: process.env,
      windowsHide: true,
    })
    child.unref()
  } finally {
    closeSync(log)
  }
}

async function fetchManifest(
  registryUrl: string,
  kind: string,
  fetchImpl: typeof fetch = fetch
): Promise<AdapterManifest> {
  const url = `${registryUrl.replace(/\/+$/, '')}/${encodeURIComponent(kind)}/manifest.json`
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'clara-adapter' },
    redirect: 'follow',
    signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new AdapterUpdateError(
      409,
      'registry_unavailable',
      `The adapter registry answered ${response.status}.`
    )
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
    throw new AdapterUpdateError(409, 'registry_invalid', 'The adapter manifest is too large.')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new AdapterUpdateError(409, 'registry_invalid', 'The adapter manifest is not valid JSON.')
  }
  return parseManifest(value, kind)
}

export function parseManifest(value: unknown, kind: string): AdapterManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdapterUpdateError(409, 'registry_invalid', 'The adapter manifest is invalid.')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || record.harness !== kind) {
    throw new AdapterUpdateError(
      409,
      'registry_invalid',
      `The manifest is not a ${kind} adapter manifest.`
    )
  }
  if (typeof record.version !== 'string' || !isAdapterVersion(record.version)) {
    throw new AdapterUpdateError(
      409,
      'registry_invalid',
      'The adapter manifest has an invalid version.'
    )
  }
  if (!record.artifacts || typeof record.artifacts !== 'object') {
    throw new AdapterUpdateError(409, 'registry_invalid', 'The adapter manifest has no artifacts.')
  }
  const artifacts: AdapterManifest['artifacts'] = {}
  for (const [target, raw] of Object.entries(record.artifacts as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.url !== 'string' || typeof entry.sha256 !== 'string') continue
    if (!SHA256.test(entry.sha256)) continue
    artifacts[target] = {
      url: entry.url,
      sha256: entry.sha256,
      ...(typeof entry.size === 'number' && entry.size > 0 ? { size: entry.size } : {}),
    }
  }
  return { schemaVersion: 1, harness: kind, version: record.version, artifacts }
}

function allowedArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return (
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1'
    )
  } catch {
    return false
  }
}

function adapterUpdatePlanPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'update-plan.json')
}

function writeAdapterUpdateStatus(
  paths: AdapterPaths,
  status: Omit<AdapterUpdateStatus, 'updatedAt'>
): void {
  writeJson(adapterUpdateStatusPath(paths), {
    ...status,
    updatedAt: new Date().toISOString(),
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

function readPlan(path: string): AdapterUpdatePlan {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterUpdatePlan>
  if (
    value.schemaVersion !== 1 ||
    typeof value.kind !== 'string' ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.platform !== 'string' ||
    typeof value.oldRoot !== 'string' ||
    typeof value.newRoot !== 'string' ||
    typeof value.registryUrl !== 'string' ||
    typeof value.pid !== 'number'
  ) {
    throw new Error('The adapter update plan is invalid.')
  }
  return {
    schemaVersion: 1,
    kind: value.kind,
    label: typeof value.label === 'string' ? value.label : value.kind,
    from: value.from,
    to: value.to,
    platform: value.platform,
    oldRoot: value.oldRoot,
    newRoot: value.newRoot,
    registryUrl: value.registryUrl,
    installArgs: Array.isArray(value.installArgs)
      ? value.installArgs.filter((arg): arg is string => typeof arg === 'string')
      : [],
    pid: value.pid,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
  }
}

function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): ReturnType<typeof spawnSync> {
  console.log(`$ ${command} ${args.join(' ')}`)
  return spawnSync(command, [...args], { stdio: 'inherit', env, windowsHide: true })
}

async function waitForAuthentication(
  paths: AdapterPaths,
  oldPid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = readState(paths.statePath)
    if (
      state &&
      state.pid !== oldPid &&
      adapterProcessAlive(state.pid) &&
      state.hub.authenticated
    ) {
      return true
    }
    await sleep(500)
  }
  return false
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!adapterProcessAlive(pid)) return
    await sleep(100)
  }
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
