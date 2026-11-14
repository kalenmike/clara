import type { ClaraSession } from '@clara/api-contract'
import { HarnessClient } from '@clara/harness-protocol'
import type { AdapterEnrollAction, PanelTransport } from '@clara/shared-types'
import type { ProjectStore } from '../projects/store.ts'
import type { HarnessMetadataStore } from './metadata.ts'
import type { EnrollAdapterInput, EnrollAdapterResult, HarnessStore } from './store.ts'
import {
  HarnessOfflineError,
  HarnessUnconfiguredError,
  type HarnessConnection,
  type HarnessPairing,
  type HarnessProbe,
  type HarnessRequestInput,
  type HarnessTransport,
} from './types.ts'

export type HarnessChangeListener = () => void | Promise<void>

type Fetch = (request: Request) => Promise<Response>

export class HarnessManager {
  private readonly store: HarnessStore
  readonly metadata: HarnessMetadataStore
  readonly projects: ProjectStore
  private readonly listeners = new Set<HarnessChangeListener>()
  private readonly live = new Map<string, Fetch>()
  private error?: string
  private generationValue = 0

  constructor(store: HarnessStore, metadata: HarnessMetadataStore, projects: ProjectStore) {
    this.store = store
    this.metadata = metadata
    this.projects = projects
  }

  get configured(): boolean {
    return this.store.list().length > 0
  }

  get generation(): number {
    return this.generationValue
  }

  /** The selected default harness, or the first paired one when none is flagged. */
  get active(): HarnessConnection | undefined {
    return this.store.active() ?? this.store.list()[0]
  }

  get lastError(): string | undefined {
    return this.error
  }

  list(): HarnessConnection[] {
    return this.store.list()
  }

  async load(): Promise<void> {
    this.store.resetOnline()
    this.bump()
  }

  async probe(timeoutMs = 2_000): Promise<HarnessProbe> {
    return this.probeConnection(this.active?.id, timeoutMs)
  }

  async probeConnection(id: string | undefined, timeoutMs = 2_000): Promise<HarnessProbe> {
    const active = id ? this.store.get(id) : this.active
    if (!active) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'unconfigured',
        message: 'No harness connection is configured',
      }
    }
    const fetch = this.live.get(active.harnessId)
    if (!fetch) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'offline',
        message: 'The harness adapter is offline',
      }
    }

    const started = Date.now()
    const controller = new AbortController()
    try {
      const response = await withTimeout(
        fetch(
          new Request('http://adapter/harness/v1/health', {
            signal: controller.signal,
          })
        ),
        timeoutMs,
        () => controller.abort(timeoutError(timeoutMs))
      )
      const latencyMs = Date.now() - started
      if (response.status === 404) {
        // Older adapters only expose `/info`; keep probing them without
        // pretending the cached harness version proves OpenCode is reachable.
        return await this.probeInfo(fetch, timeoutMs, started)
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          latencyMs,
          code: 'http',
          message: `The adapter responded with ${response.status}`,
        }
      }
      const health = (await response.json()) as {
        ok?: unknown
        version?: unknown
        status?: unknown
        latencyMs?: unknown
        code?: unknown
        message?: unknown
      }
      if (typeof health.ok !== 'boolean') {
        return {
          ok: false,
          latencyMs,
          code: 'unsupported',
          message: 'The adapter returned an invalid health result',
        }
      }
      return {
        ok: health.ok,
        latencyMs:
          typeof health.latencyMs === 'number' && Number.isFinite(health.latencyMs)
            ? health.latencyMs
            : latencyMs,
        code: typeof health.code === 'string' ? (health.code as HarnessProbe['code']) : 'http',
        ...(typeof health.version === 'string' ? { version: health.version } : {}),
        ...(typeof health.status === 'number' ? { status: health.status } : {}),
        ...(typeof health.message === 'string' ? { message: health.message } : {}),
      }
    } catch (cause) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        code: cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'unreachable',
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }

  private async probeInfo(fetch: Fetch, timeoutMs: number, started: number): Promise<HarnessProbe> {
    const controller = new AbortController()
    try {
      const response = await withTimeout(
        fetch(
          new Request('http://adapter/harness/v1/info', {
            signal: controller.signal,
          })
        ),
        timeoutMs,
        () => controller.abort(timeoutError(timeoutMs))
      )
      const latencyMs = Date.now() - started
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          latencyMs,
          code: 'http',
          message: `The adapter responded with ${response.status}`,
        }
      }
      const info = (await response.json()) as {
        harness?: { version?: unknown }
      }
      return {
        ok: true,
        latencyMs,
        code: 'ok',
        ...(typeof info.harness?.version === 'string' ? { version: info.harness.version } : {}),
      }
    } catch (cause) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        code: cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'unreachable',
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }

  async request(input: HarnessRequestInput, signal: AbortSignal): Promise<Response> {
    const active = this.active
    if (!active) throw new HarnessUnconfiguredError()
    return this.requestFor(active.harnessId, input, signal)
  }

  /**
   * Send a request to one paired harness even when another connection is
   * active. Project workspace sync and archive/delete need to reach every
   * linked harness, not only the one that serves sessions.
   */
  async requestFor(
    harnessId: string,
    input: HarnessRequestInput,
    signal: AbortSignal
  ): Promise<Response> {
    const fetch = this.live.get(harnessId)
    if (!fetch) throw new HarnessOfflineError()
    return new HarnessClient({ fetch, baseUrl: 'http://adapter' }).request({
      ...input,
      signal,
    })
  }

  connection(harnessId: string): HarnessConnection | undefined {
    return this.store.list().find((connection) => connection.harnessId === harnessId)
  }

  async reload(): Promise<void> {
    // The adapter owns its upstream lifecycle. A new adapter session reconnects
    // automatically; there is nothing to reload here.
  }

  async activate(id: string): Promise<HarnessConnection> {
    const connection = this.store.setActive(id)
    this.bump()
    await this.notify()
    return connection
  }

  async remove(id: string): Promise<void> {
    const connection = this.store.get(id)
    const wasActive = connection?.isActive === true
    this.store.remove(id)
    if (connection) this.live.delete(connection.harnessId)
    if (wasActive) this.promoteActive()
    this.bump()
    await this.notify()
  }

  async forget(id: string): Promise<void> {
    const connection = this.store.get(id)
    const wasActive = connection?.isActive === true
    this.store.forget(id)
    if (connection) this.live.delete(connection.harnessId)
    if (wasActive) this.promoteActive()
    this.bump()
    await this.notify()
  }

  /** Keep one default when the active harness is deleted or forgotten. */
  private promoteActive(): void {
    if (this.store.active()) return
    const next = this.store.list()[0]
    if (next) this.store.setActive(next.id)
  }

  async createPairing(input: { kind: string; label: string }): Promise<HarnessPairing> {
    return this.store.createPairing(input)
  }

  listPairings(): HarnessPairing[] {
    return this.store.listPairings()
  }

  async pairingToken(id: string): Promise<string | undefined> {
    return this.store.pairingToken(id)
  }

  cancelPairing(id: string): void {
    this.store.cancelPairing(id)
  }

  async enroll(input: EnrollAdapterInput): Promise<EnrollAdapterResult> {
    const result = await this.store.enroll(input)
    this.bump()
    await this.notify()
    return result
  }

  async enrollAdapter(
    action: AdapterEnrollAction,
    pairToken: string,
    transport: PanelTransport
  ): Promise<EnrollAdapterResult> {
    return this.enroll({
      pairId: action.id ?? '',
      pairToken,
      harnessId: action.harnessId,
      kind: action.kind,
      label: action.label,
      adapterId: action.credentialId,
      key: action.key,
      adapterVersion: action.adapterVersion,
      protocolVersion: action.protocolVersion,
      ...(action.harnessVersion ? { harnessVersion: action.harnessVersion } : {}),
      capabilities: action.capabilities,
      transport: transport === 'relay' ? 'relay' : 'local',
    })
  }

  credential(adapterId: string) {
    return this.store.credential(adapterId)
  }

  async setLive(harnessId: string, fetch: Fetch, transport: HarnessTransport): Promise<void> {
    void transport
    const connection = this.store.list().find((item) => item.harnessId === harnessId)
    const active = this.store.active()
    if (connection && (active === undefined || !active.credentialConfigured)) {
      this.store.setActive(connection.id)
    }
    this.live.set(harnessId, fetch)
    this.store.setOnline(harnessId, true)
    this.bump()
    await this.notify()
  }

  async clearLive(harnessId: string, fetch?: Fetch): Promise<void> {
    // A late close from an old adapter session must not remove the session that
    // replaced it. Without a fetch argument the caller explicitly clears it.
    if (fetch && this.live.get(harnessId) !== fetch) return
    this.live.delete(harnessId)
    this.store.setOnline(harnessId, false)
    this.bump()
    await this.notify()
  }

  recordTest(id: string, ok: boolean, error?: string): void {
    this.store.recordTest(id, ok, error)
  }

  async redactionValues(): Promise<string[]> {
    return this.store.redactionValues()
  }

  subscribe(listener: HarnessChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get harnessId(): string | undefined {
    return this.active?.harnessId
  }

  overlaySession(harnessId: string, session: ClaraSession): ClaraSession {
    return this.metadata.overlaySession(harnessId, session)
  }

  overlaySessionList(value: { data: ClaraSession[]; cursor: unknown }): {
    data: ClaraSession[]
    cursor: unknown
  } {
    const harnessId = this.harnessId
    return harnessId
      ? {
          ...value,
          data: value.data.map((session) => this.metadata.overlaySession(harnessId, session)),
        }
      : value
  }

  harnessProjectIds(projectId: string): string[] {
    const harnessId = this.harnessId
    return harnessId ? this.projects.harnessProjectIds(harnessId, projectId) : []
  }

  private bump(): void {
    this.generationValue += 1
  }

  private async notify(): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener()
      } catch {
        // A listener must never make a saved connection unusable.
      }
    }
  }
}

/**
 * Bound a probe even if the transport ignores its abort signal. A hung probe
 * otherwise stays cached in the panel runtime and blocks every later snapshot.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout()
          reject(timeoutError(timeoutMs))
        }, timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`The adapter did not answer within ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}
