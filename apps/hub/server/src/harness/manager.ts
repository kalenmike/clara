import type { ClaraSession } from '@clara/api-contract'
import { HarnessClient } from '@clara/harness-protocol'
import type { HarnessInfo } from '@clara/harness-protocol'
import type {
  AdapterEnrollAction,
  AdapterHostIdentity,
  HarnessInstallMethod,
  HostResourceMetrics,
  PanelTransport,
} from '@clara/shared-types'
import type { ProjectStore } from '../projects/store.ts'
import type { HarnessMetadataStore } from './metadata.ts'
import type { EnrollAdapterInput, EnrollAdapterResult, HarnessStore } from './store.ts'
import {
  HarnessOfflineError,
  type HarnessConnection,
  type HarnessPairing,
  type HarnessProbe,
  type HarnessRequestInput,
  type HarnessTransport,
} from './types.ts'

export type HarnessChangeListener = () => void | Promise<void>

/**
 * The outcome of asking one adapter for a host sample. `unsupported` is stable
 * for the life of that adapter session, so the panel can stop asking until the
 * adapter reconnects.
 */
export type HarnessHostResources =
  | { state: 'ok'; metrics: HostResourceMetrics }
  | { state: 'unsupported' }
  | { state: 'unavailable' }

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

  async probeConnection(id: string, timeoutMs = 2_000): Promise<HarnessProbe> {
    const connection = this.store.get(id)
    if (!connection) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'unconfigured',
        message: 'That harness connection no longer exists',
      }
    }
    const fetch = this.live.get(connection.harnessId)
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

  /**
   * Ask one live adapter for its latest host sample. This never throws: an
   * offline adapter, a timeout, or an old adapter without the route all read as
   * unavailable or unsupported so the panel can keep rendering.
   */
  async hostResources(harnessId: string, timeoutMs = 1_500): Promise<HarnessHostResources> {
    const fetch = this.live.get(harnessId)
    if (!fetch) return { state: 'unavailable' }

    const controller = new AbortController()
    try {
      const response = await withTimeout(
        fetch(
          new Request('http://adapter/harness/v1/host', {
            signal: controller.signal,
          })
        ),
        timeoutMs,
        () => controller.abort(timeoutError(timeoutMs))
      )
      if (response.status === 404) return { state: 'unsupported' }
      if (!response.ok) return { state: 'unavailable' }
      const value = (await response.json()) as unknown
      return isHostResourceMetrics(value)
        ? { state: 'ok', metrics: value }
        : { state: 'unavailable' }
    } catch {
      return { state: 'unavailable' }
    }
  }

  /** Send a request to one paired harness. Every route names its harness. */
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

  async remove(id: string): Promise<void> {
    const connection = this.store.get(id)
    this.store.remove(id)
    if (connection) this.live.delete(connection.harnessId)
    this.bump()
    await this.notify()
  }

  async forget(id: string): Promise<void> {
    const connection = this.store.get(id)
    this.store.forget(id)
    if (connection) this.live.delete(connection.harnessId)
    this.bump()
    await this.notify()
  }

  async createPairing(input: {
    kind: string
    label: string
    installMethod?: HarnessInstallMethod
  }): Promise<HarnessPairing> {
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
      ...(action.host ? { host: action.host } : {}),
    })
  }

  credential(adapterId: string) {
    return this.store.credential(adapterId)
  }

  async setLive(harnessId: string, fetch: Fetch, transport: HarnessTransport): Promise<void> {
    void transport
    this.live.set(harnessId, fetch)
    this.store.setOnline(harnessId, true)
    this.bump()
    await this.notify()
    void this.refreshInfo(harnessId)
  }

  /**
   * A reconnect is the only time an adapter can report a new version or
   * capability set outside enrollment. Read `/info` in the background so an
   * upgrade or a manual restart updates the panel without a new pairing.
   */
  private async refreshInfo(harnessId: string): Promise<void> {
    const fetch = this.live.get(harnessId)
    if (!fetch) return
    try {
      const info = await withTimeout(
        new HarnessClient({ fetch, baseUrl: 'http://adapter' }).info(
          AbortSignal.timeout(3_000)
        ),
        3_500,
        () => {}
      )
      if (this.live.get(harnessId) !== fetch) return
      if (this.store.setAdapterInfo(harnessId, adapterInfo(info))) {
        this.bump()
        await this.notify()
      }
    } catch {
      // An older adapter may not expose /info; enrollment data still applies.
    }
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

  async setHost(harnessId: string, host: AdapterHostIdentity): Promise<void> {
    if (!this.store.setHost(harnessId, host)) return
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

  overlaySession(harnessId: string, session: ClaraSession): ClaraSession {
    return this.metadata.overlaySession(harnessId, session)
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

function adapterInfo(info: HarnessInfo): {
  adapterVersion: string
  protocolVersion: number
  harnessVersion?: string
  capabilities: Record<string, unknown>
} {
  return {
    adapterVersion: info.adapter.version,
    protocolVersion: info.protocol,
    ...(info.harness.version ? { harnessVersion: info.harness.version } : {}),
    capabilities: info.capabilities,
  }
}

function isHostResourceMetrics(value: unknown): value is HostResourceMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sampledAt === 'string' &&
    typeof record.platform === 'string' &&
    typeof record.arch === 'string' &&
    typeof record.cpu === 'object' &&
    record.cpu !== null &&
    typeof record.memory === 'object' &&
    record.memory !== null &&
    Array.isArray(record.disks)
  )
}
