import { statSync } from 'node:fs'
import { AdapterError } from '@clara/adapter-runtime'
import type { PiConfig } from '../config.ts'
import { piProcessEnv } from '../discover.ts'
import { PiRpcClient, type PiRpcRecord, type PiState, type PiUiRequest } from './client.ts'

const READY_TIMEOUT_MS = 60_000
const EVICTION_INTERVAL_MS = 30_000

export type PiSessionTarget = {
  sessionID: string
  path: string
  cwd: string
  name?: string
  /** The file exists already and can be opened with `--session`. */
  existing: boolean
}

export type PiSessionHandle = {
  sessionID: string
  path: string
  cwd: string
  client: PiRpcClient
  state: PiState
  startedAt: number
  lastUsedAt: number
  busy: boolean
  /** File stamp after the last settled turn, used to spot external writers. */
  stamp?: string
}

export type PiManagerOptions = {
  config: PiConfig
  binary: string
  onEvent(handle: PiSessionHandle, event: PiRpcRecord): void
  onUiRequest(handle: PiSessionHandle, request: PiUiRequest): void
  onExit(handle: PiSessionHandle, code: number | null, signal: string | null): void
}

/**
 * Owns one Pi child per session. Pi normally loads extensions and MCP servers
 * per process, so idle children are evicted and the process count is bounded.
 */
export class PiProcessManager {
  private readonly options: PiManagerOptions
  private readonly handles = new Map<string, PiSessionHandle>()
  private readonly opening = new Map<string, Promise<PiSessionHandle>>()
  private readonly eviction: NodeJS.Timeout
  private closed = false

  constructor(options: PiManagerOptions) {
    this.options = options
    this.eviction = setInterval(() => this.evict(), EVICTION_INTERVAL_MS)
    this.eviction.unref?.()
  }

  get(sessionID: string): PiSessionHandle | undefined {
    const handle = this.handles.get(sessionID)
    return handle && handle.client.alive ? handle : undefined
  }

  list(): PiSessionHandle[] {
    return [...this.handles.values()].filter((handle) => handle.client.alive)
  }

  async open(
    target: PiSessionTarget,
    options: { keepExternal?: boolean } = {}
  ): Promise<PiSessionHandle> {
    const existing = this.get(target.sessionID)
    if (existing) {
      existing.lastUsedAt = Date.now()
      if (!existing.busy && !options.keepExternal && this.changedExternally(existing)) {
        await this.dispose(target.sessionID)
      } else {
        return existing
      }
    }
    const pending = this.opening.get(target.sessionID)
    if (pending) return pending
    const promise = this.start(target).finally(() => this.opening.delete(target.sessionID))
    this.opening.set(target.sessionID, promise)
    return promise
  }

  async dispose(sessionID: string): Promise<void> {
    const handle = this.handles.get(sessionID)
    if (!handle) return
    this.handles.delete(sessionID)
    await handle.client.close()
  }

  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.eviction)
    await Promise.all([...this.handles.keys()].map((sessionID) => this.dispose(sessionID)))
  }

  markBusy(handle: PiSessionHandle, busy: boolean): void {
    handle.busy = busy
    handle.lastUsedAt = Date.now()
    if (!busy) handle.stamp = stamp(handle.path)
  }

  changedExternally(handle: PiSessionHandle): boolean {
    if (!handle.stamp) return false
    return stamp(handle.path) !== handle.stamp
  }

  private async start(target: PiSessionTarget): Promise<PiSessionHandle> {
    if (this.closed) throw new AdapterError(503, 'harness_offline', 'The adapter is shutting down')
    const binary = this.options.binary
    const cwd = target.cwd
    try {
      const stats = statSync(cwd)
      if (!stats.isDirectory()) throw new Error('not a directory')
    } catch {
      throw new AdapterError(
        409,
        'location_missing',
        `The Pi session directory ${cwd} does not exist on the harness machine`
      )
    }
    const client = await PiRpcClient.start({
      binary,
      cwd,
      env: piProcessEnv(this.options.config),
      ...(target.existing ? { sessionFile: target.path } : { sessionId: target.sessionID }),
      ...(target.name ? { name: target.name } : {}),
      ...(this.options.config.model ? { model: this.options.config.model } : {}),
      ...(this.options.config.thinkingLevel
        ? { thinkingLevel: this.options.config.thinkingLevel }
        : {}),
      trust: this.options.config.trust ?? 'inherit',
    })
    let state: PiState
    try {
      state = await client.request<PiState>({ type: 'get_state' }, READY_TIMEOUT_MS)
    } catch (cause) {
      await client.close(1_000)
      throw cause
    }
    const handle: PiSessionHandle = {
      sessionID: target.sessionID,
      path: state.sessionFile ?? target.path,
      cwd,
      client,
      state,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      busy: false,
      stamp: stamp(target.path),
    }
    client.onEvent((event) => this.options.onEvent(handle, event))
    client.onUiRequest((request) => this.options.onUiRequest(handle, request))
    client.onExit((code, signal) => {
      if (this.handles.get(handle.sessionID) === handle) {
        this.handles.delete(handle.sessionID)
      }
      this.options.onExit(handle, code, signal)
    })
    this.handles.set(target.sessionID, handle)
    this.enforceLimit(handle.sessionID)
    return handle
  }

  private enforceLimit(keep: string): void {
    const max = Math.max(1, this.options.config.maxProcesses ?? 3)
    const idle = this.list()
      .filter((handle) => !handle.busy && handle.sessionID !== keep)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    while (this.list().length > max && idle.length > 0) {
      const victim = idle.shift()
      if (victim) void this.dispose(victim.sessionID)
    }
  }

  private evict(): void {
    const minutes = Math.max(1, this.options.config.idleTimeoutMinutes ?? 15)
    const cutoff = Date.now() - minutes * 60_000
    for (const handle of this.list()) {
      if (!handle.busy && handle.lastUsedAt < cutoff) void this.dispose(handle.sessionID)
    }
  }
}

function stamp(path: string): string | undefined {
  try {
    const stats = statSync(path)
    return `${stats.size}:${stats.mtimeMs}`
  } catch {
    return undefined
  }
}
