import type { ClaraProject, ClaraSession } from '@clara/api-contract'
import { HarnessClient } from '@clara/harness-protocol'
import type { AdapterEnrollAction, PanelTransport } from '@clara/shared-types'
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
  private readonly listeners = new Set<HarnessChangeListener>()
  private readonly live = new Map<string, Fetch>()
  private error?: string
  private generationValue = 0

  constructor(store: HarnessStore, metadata: HarnessMetadataStore) {
    this.store = store
    this.metadata = metadata
  }

  get configured(): boolean {
    return this.store.active() !== undefined
  }

  get generation(): number {
    return this.generationValue
  }

  get active(): HarnessConnection | undefined {
    return this.store.active()
  }

  get lastError(): string | undefined {
    return this.error
  }

  list(): HarnessConnection[] {
    return this.store.list()
  }

  async load(): Promise<void> {
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
    try {
      const response = await fetch(
        new Request('http://adapter/harness/v1/info', {
          signal: AbortSignal.timeout(timeoutMs),
        })
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
        adapter?: { version?: unknown }
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
    const fetch = this.live.get(active.harnessId)
    if (!fetch) throw new HarnessOfflineError()
    return new HarnessClient({ fetch, baseUrl: 'http://adapter' }).request({
      ...input,
      signal,
    })
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
    this.store.remove(id)
    this.bump()
    await this.notify()
  }

  async forget(id: string): Promise<void> {
    this.store.forget(id)
    this.bump()
    await this.notify()
  }

  async createPairing(input: {
    kind: string
    label: string
    replacesConnectionId?: string
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
    })
  }

  credential(adapterId: string) {
    return this.store.credential(adapterId)
  }

  async setLive(harnessId: string, fetch: Fetch, transport: HarnessTransport): Promise<void> {
    void transport
    const connection = this.store.list().find((item) => item.harnessId === harnessId)
    const active = this.store.active()
    if (
      connection &&
      (active === undefined ||
        !active.credentialConfigured ||
        active.harnessId.startsWith('legacy-'))
    ) {
      this.store.setActive(connection.id)
    }
    this.live.set(harnessId, fetch)
    this.store.setOnline(harnessId, true)
    this.bump()
    await this.notify()
  }

  async clearLive(harnessId: string): Promise<void> {
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

  overlayProject(harnessId: string, project: ClaraProject): ClaraProject {
    return this.metadata.overlayProject(harnessId, project)
  }

  overlayProjectList(projects: ClaraProject[]): ClaraProject[] {
    const harnessId = this.harnessId
    return harnessId
      ? projects.map((project) => this.metadata.overlayProject(harnessId, project))
      : projects
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

  harnessProjectId(projectId: string): string | undefined {
    const harnessId = this.harnessId
    return harnessId ? this.metadata.harnessProjectId(harnessId, projectId) : undefined
  }

  updateProject(
    projectId: string,
    patch: { name?: string; icon?: unknown; commands?: unknown; startupScript?: string }
  ): ClaraProject | undefined {
    const state = this.metadata.updateProject(projectId, patch)
    if (!state) return undefined
    return {
      id: state.id,
      canonical: state.canonical,
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now(), active: Date.now() },
      ...(state.name ? { name: state.name } : {}),
      ...(state.icon ? { icon: state.icon } : {}),
      ...(state.commands ? { commands: state.commands } : {}),
    }
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
