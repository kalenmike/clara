import type { HttpRequestAction } from '../opencode.ts'
import { OpenCodeClient } from '../opencode.ts'
import type { HarnessStore } from './store.ts'
import { HarnessUnconfiguredError, type HarnessConnection, type HarnessProbe } from './types.ts'
import { validateHarnessInput } from './validation.ts'

export type HarnessChangeListener = () => void | Promise<void>

/**
 * Owns the one active harness connection. Everything that used to receive a
 * fixed OpenCodeClient now resolves the current client here, so saving a
 * connection can swap the backend without restarting the process.
 */
export class HarnessManager {
  private readonly store: HarnessStore
  private readonly listeners = new Set<HarnessChangeListener>()
  private client?: OpenCodeClient
  private connection?: HarnessConnection
  private error?: string
  private generationValue = 0

  constructor(store: HarnessStore) {
    this.store = store
  }

  get configured(): boolean {
    return this.client !== undefined
  }

  get generation(): number {
    return this.generationValue
  }

  get active(): HarnessConnection | undefined {
    return this.connection
  }

  get lastError(): string | undefined {
    return this.error
  }

  list(): HarnessConnection[] {
    return this.store.list()
  }

  async load(): Promise<void> {
    await this.applyActive()
  }

  async probe(timeoutMs = 2_000): Promise<HarnessProbe> {
    if (!this.client) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'unconfigured',
        message: 'No harness connection is configured',
      }
    }
    return this.client.probe(timeoutMs)
  }

  async request(action: HttpRequestAction, signal: AbortSignal): Promise<Response> {
    if (!this.client) throw new HarnessUnconfiguredError()
    return this.client.request(action, signal)
  }

  async reload(timeoutMs = 5_000): Promise<void> {
    if (!this.client?.reload) return
    await this.client.reload(timeoutMs)
  }

  async save(value: unknown, id?: string): Promise<HarnessConnection> {
    const connection = await this.store.save(value, id)
    if (connection.isActive) await this.applyActive()
    await this.notify()
    return connection
  }

  async activate(id: string): Promise<HarnessConnection> {
    const connection = this.store.setActive(id)
    await this.applyActive()
    await this.notify()
    return connection
  }

  async remove(id: string): Promise<void> {
    const wasActive = this.connection?.id === id
    this.store.remove(id)
    if (wasActive) await this.applyActive()
    await this.notify()
  }

  async test(value: unknown, id?: string): Promise<HarnessProbe> {
    const hasSecret = id ? this.store.hasSecret(id) : false
    const candidate = validateHarnessInput(value, { hasSecret })
    const password = candidate.password ?? (id ? await this.store.secret(id) : undefined)
    const client = buildClient(candidate.kind, candidate.baseUrl, password)
    const result = await client.probe()
    if (id) this.store.recordTest(id, result.ok, result.ok ? undefined : result.message)
    return result
  }

  async redactionValues(): Promise<string[]> {
    return this.store.redactionValues()
  }

  subscribe(listener: HarnessChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async applyActive(): Promise<void> {
    this.generationValue += 1
    this.error = undefined
    let active: Awaited<ReturnType<HarnessStore['activeSecret']>>
    try {
      active = await this.store.activeSecret()
    } catch (cause) {
      this.client = undefined
      this.connection = undefined
      this.error = errorMessage(cause)
      return
    }
    if (!active) {
      this.client = undefined
      this.connection = undefined
      return
    }

    try {
      this.client = buildClient(active.connection.kind, active.connection.baseUrl, active.password)
      this.connection = active.connection
    } catch (cause) {
      this.client = undefined
      this.connection = active.connection
      this.error = errorMessage(cause)
    }
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

function buildClient(
  kind: HarnessConnection['kind'],
  baseUrl: string,
  password: string | undefined
): OpenCodeClient {
  switch (kind) {
    case 'opencode':
      return new OpenCodeClient(baseUrl, password)
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
