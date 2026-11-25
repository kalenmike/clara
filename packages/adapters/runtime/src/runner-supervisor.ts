import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import {
  RUNNER_STALE_MS,
  RunnerClient,
  claraDataDir,
  engineToken,
  engineURL,
} from '@clara/runner'
import { selfCommand, selfEntry } from './service.ts'
import type { AdapterPaths } from './types.ts'

const RECONCILE_MS = 10_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const STOP_WAIT_MS = 5_000

/** One workspace an operator asked this adapter daemon to run a script runner for. */
export type RunnerDesired = {
  path: string
  concurrency?: number
  labels?: string[]
}

/** A supervised runner child recorded on disk by its workspace hash. */
export type RunnerChild = {
  hash: string
  pid: number
  workspace: string
}

export function runnerDesiredPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'runner.json')
}

export function runnerLogPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'runner.log')
}

export function runnerWorkspaceHash(workspace: string): string {
  return createHash('sha256').update(workspace).digest('hex').slice(0, 12)
}

function childPidPath(paths: AdapterPaths, hash: string): string {
  return join(paths.dataDir, `runner-${hash}.pid`)
}

/** The workspaces `runner start` asked this adapter to serve. */
export function readRunnerDesired(paths: AdapterPaths): RunnerDesired[] {
  try {
    const parsed = JSON.parse(readFileSync(runnerDesiredPath(paths), 'utf8')) as {
      workspaces?: unknown
    }
    if (!Array.isArray(parsed.workspaces)) return []
    return parsed.workspaces.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as { path?: unknown; concurrency?: unknown; labels?: unknown }
      if (typeof entry.path !== 'string' || !entry.path.trim()) return []
      const concurrency =
        typeof entry.concurrency === 'number' && Number.isInteger(entry.concurrency) &&
        entry.concurrency > 0
          ? entry.concurrency
          : undefined
      const labels = Array.isArray(entry.labels)
        ? entry.labels.filter((label): label is string => typeof label === 'string' && !!label)
        : undefined
      return [{ path: entry.path, ...(concurrency ? { concurrency } : {}), ...(labels?.length ? { labels } : {}) }]
    })
  } catch {
    return []
  }
}

export function writeRunnerDesired(paths: AdapterPaths, entries: RunnerDesired[]): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  const path = runnerDesiredPath(paths)
  const temporary = `${path}.tmp`
  writeFileSync(
    temporary,
    `${JSON.stringify({ workspaces: entries, updatedAt: Date.now() }, null, 2)}\n`,
    { mode: 0o600 }
  )
  renameSync(temporary, path)
}

/** Runner children this adapter recorded, whether or not their processes live. */
export function listRunnerChildren(paths: AdapterPaths): RunnerChild[] {
  let names: string[] = []
  try {
    names = readdirSync(paths.dataDir)
  } catch {
    return []
  }
  const children: RunnerChild[] = []
  for (const name of names) {
    if (!name.startsWith('runner-') || !name.endsWith('.pid')) continue
    const hash = name.slice('runner-'.length, -'.pid'.length)
    if (!hash) continue
    const child = readChild(paths, hash)
    if (child) children.push(child)
  }
  return children
}

function readChild(paths: AdapterPaths, hash: string): RunnerChild | undefined {
  try {
    const parsed = JSON.parse(readFileSync(childPidPath(paths, hash), 'utf8')) as {
      pid?: unknown
      workspace?: unknown
    }
    if (typeof parsed.pid !== 'number' || typeof parsed.workspace !== 'string') return undefined
    return { hash, pid: parsed.pid, workspace: parsed.workspace }
  } catch {
    return undefined
  }
}

function removeChild(paths: AdapterPaths, hash: string): void {
  rmSync(childPidPath(paths, hash), { force: true })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function terminate(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + STOP_WAIT_MS
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return !alive(pid)
}

/**
 * Stop the locally supervised runner children, optionally only the one serving
 * a workspace. The daemon's reconcile loop will not restart them while the
 * desired state excludes that workspace.
 */
export async function stopRunnerChildren(
  paths: AdapterPaths,
  options: { workspace?: string } = {}
): Promise<number[]> {
  const wanted = options.workspace ? runnerWorkspaceHash(options.workspace) : undefined
  const stopped: number[] = []
  for (const child of listRunnerChildren(paths)) {
    if (wanted !== undefined && child.hash !== wanted) continue
    if (alive(child.pid)) {
      terminate(child.pid)
      await waitForExit(child.pid)
      stopped.push(child.pid)
    }
    removeChild(paths, child.hash)
  }
  return stopped
}

export type RunnerSupervisorOptions = {
  /** Adapter kind; it supervises runners for harness rows it registered. */
  name: string
  paths: AdapterPaths
  env?: NodeJS.ProcessEnv
  intervalMs?: number
  log?: (message: string) => void
  /** Test override for the runner child spawn. */
  spawnChild?: (command: string, args: string[]) => ChildProcess
}

/**
 * The adapter daemon owns the script-runner topology on its machine. Each
 * reconcile pass derives the desired workspaces from two sources: the
 * `runner.json` desired state written by `clara-adapter-<kind> runner
 * start|stop`, and the engine's live harness registrations for this machine.
 * It then converges to exactly one supervised `__runner` child per
 * (machine, workspace), with backoff after crashes and a shared data-dir lock
 * so two adapter daemons never duplicate a workspace.
 */
export class RunnerSupervisor {
  private readonly name: string
  private readonly paths: AdapterPaths
  private readonly env: NodeJS.ProcessEnv
  private readonly intervalMs: number
  private readonly log: (message: string) => void
  private readonly spawnChild: (command: string, args: string[]) => ChildProcess
  private timer?: NodeJS.Timeout
  private tracked = new Map<string, { pid: number; workspace: string; proc?: ChildProcess }>()
  private backoff = new Map<string, { failures: number; nextAt: number }>()
  private skipping = new Set<string>()
  private stopping = false
  private reconciling = false
  /** Identifies this supervisor instance in the workspace lock across restarts. */
  private readonly ownerId = randomUUID()

  constructor(options: RunnerSupervisorOptions) {
    this.name = options.name
    this.paths = options.paths
    this.env = options.env ?? process.env
    this.intervalMs = options.intervalMs ?? RECONCILE_MS
    this.log = options.log ?? (() => {})
    this.spawnChild =
      options.spawnChild ??
      ((command, args) => {
        mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 })
        const log = openSync(runnerLogPath(this.paths), 'a', 0o600)
        try {
          return spawn(command, args, {
            detached: false,
            stdio: ['ignore', log, log],
            env: this.env,
            windowsHide: true,
          })
        } finally {
          closeSync(log)
        }
      })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.reconcile(), this.intervalMs)
    this.timer.unref()
    void this.reconcile()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const [hash, child] of this.tracked) {
      if (alive(child.pid)) {
        terminate(child.pid)
        await waitForExit(child.pid)
      }
      removeChild(this.paths, hash)
      rmSync(this.lockPath(hash), { force: true })
    }
    this.tracked.clear()
  }

  async reconcile(): Promise<void> {
    if (this.reconciling || this.stopping) return
    this.reconciling = true
    try {
      const desired = await this.desiredWorkspaces()
      for (const [hash, child] of [...this.tracked]) {
        if (desired.has(hash)) continue
        if (alive(child.pid)) {
          terminate(child.pid)
          await waitForExit(child.pid)
        }
        this.tracked.delete(hash)
        removeChild(this.paths, hash)
        rmSync(this.lockPath(hash), { force: true })
        this.log(`stopped the runner for ${child.workspace}`)
      }
      for (const [hash, entry] of desired) {
        const existing = this.tracked.get(hash) ?? readChild(this.paths, hash)
        if (existing && alive(existing.pid)) {
          if (this.lockHeldByOther(hash)) {
            // Another daemon owns this workspace now; drop any leftover child of
            // ours so there is exactly one runner per (machine, workspace).
            terminate(existing.pid)
            await waitForExit(existing.pid)
            this.tracked.delete(hash)
            removeChild(this.paths, hash)
            if (!this.skipping.has(hash)) {
              this.skipping.add(hash)
              this.log(`another adapter already runs the runner for ${entry.path}`)
            }
            continue
          }
          this.skipping.delete(hash)
          this.claimLock(hash, entry.path)
          this.tracked.set(hash, { pid: existing.pid, workspace: existing.workspace })
          continue
        }
        if (existing) removeChild(this.paths, hash)
        const wait = this.backoff.get(hash)
        if (wait && wait.nextAt > Date.now()) continue
        if (!this.claimLock(hash, entry.path)) {
          if (!this.skipping.has(hash)) {
            this.skipping.add(hash)
            this.log(`another adapter already runs the runner for ${entry.path}`)
          }
          continue
        }
        this.skipping.delete(hash)
        this.spawn(hash, entry)
      }
    } finally {
      this.reconciling = false
    }
  }

  private async desiredWorkspaces(): Promise<Map<string, RunnerDesired>> {
    const map = new Map<string, RunnerDesired>()
    for (const entry of readRunnerDesired(this.paths)) {
      map.set(runnerWorkspaceHash(entry.path), entry)
    }
    for (const entry of await this.hostedHarnessWorkspaces()) {
      const hash = runnerWorkspaceHash(entry.path)
      if (!map.has(hash)) map.set(hash, entry)
    }
    return map
  }

  /**
   * Live harness registrations this adapter registered from this machine. The
   * plugin reports the harness project directory, which is exactly the
   * workspace a local runner must serve.
   */
  private async hostedHarnessWorkspaces(): Promise<RunnerDesired[]> {
    const token = engineToken(this.env)
    if (!token) return []
    try {
      const client = new RunnerClient({ url: engineURL(this.env), token, timeoutMs: 3_000 })
      const rows = await client.adapters()
      const machine = hostname()
      const now = Date.now()
      return rows
        .filter(
          (row) =>
            row.role === 'harness' && row.harness === this.name && row.machine === machine
        )
        .filter((row) => {
          const heartbeat = Date.parse(row.heartbeat_at)
          return Number.isFinite(heartbeat) && now - heartbeat <= RUNNER_STALE_MS
        })
        .map((row) => ({ path: row.workspace }))
    } catch {
      return []
    }
  }

  private lockDir(): string {
    return join(claraDataDir(this.env), 'runner-managed')
  }

  private lockPath(hash: string): string {
    return join(this.lockDir(), `${hash}.lock`)
  }

  private lockOwner(hash: string): { pid?: number; owner?: string } | undefined {
    try {
      const current = JSON.parse(readFileSync(this.lockPath(hash), 'utf8')) as {
        pid?: unknown
        owner?: unknown
      }
      return {
        ...(typeof current.pid === 'number' ? { pid: current.pid } : {}),
        ...(typeof current.owner === 'string' ? { owner: current.owner } : {}),
      }
    } catch {
      return undefined
    }
  }

  /** True when a live adapter daemon other than this one owns the workspace lock. */
  private lockHeldByOther(hash: string): boolean {
    const current = this.lockOwner(hash)
    if (!current || current.owner === this.ownerId) return false
    return current.pid !== undefined && alive(current.pid)
  }

  /** One supervised runner per (machine, workspace) across adapter daemons. */
  private claimLock(hash: string, workspace: string): boolean {
    const current = this.lockOwner(hash)
    if (
      current &&
      current.owner !== this.ownerId &&
      current.pid !== undefined &&
      alive(current.pid)
    ) {
      return false
    }
    const path = this.lockPath(hash)
    mkdirSync(this.lockDir(), { recursive: true, mode: 0o700 })
    const temporary = `${path}.tmp`
    writeFileSync(
      temporary,
      `${JSON.stringify(
        { pid: process.pid, owner: this.ownerId, adapter: this.name, workspace },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )
    renameSync(temporary, path)
    return true
  }

  private spawn(hash: string, entry: RunnerDesired): void {
    const args = ['--workspace', entry.path]
    if (entry.concurrency !== undefined) args.push('--concurrency', String(entry.concurrency))
    for (const label of entry.labels ?? []) args.push('--label', label)
    try {
      const proc = this.spawnChild(process.execPath, selfCommand(selfEntry(), '__runner', args))
      if (proc.pid === undefined) throw new Error('the runner child has no pid')
      const pidPath = childPidPath(this.paths, hash)
      writeFileSync(
        pidPath,
        `${JSON.stringify({ pid: proc.pid, workspace: entry.path, startedAt: Date.now() }, null, 2)}\n`,
        { mode: 0o600 }
      )
      this.tracked.set(hash, { pid: proc.pid, workspace: entry.path, proc })
      this.backoff.delete(hash)
      proc.once('exit', () => {
        const current = this.tracked.get(hash)
        if (!current || current.pid !== proc.pid) return
        this.tracked.delete(hash)
        removeChild(this.paths, hash)
        if (this.stopping) return
        const failures = (this.backoff.get(hash)?.failures ?? 0) + 1
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
        this.backoff.set(hash, { failures, nextAt: Date.now() + delay })
        this.log(`the runner for ${entry.path} exited; retrying in ${Math.round(delay / 1000)}s`)
      })
      this.log(`started the runner for ${entry.path} (pid ${proc.pid})`)
    } catch (cause) {
      rmSync(this.lockPath(hash), { force: true })
      this.log(
        `could not start the runner for ${entry.path}: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }
}
