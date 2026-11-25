import type { EngineAdapterRow, RunnerConfig, ScriptWorkOrder } from './types.ts'

export class RunnerHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'RunnerHttpError'
    this.status = status
  }
}

/** Minimal REST client for the runner role. */
export class RunnerClient {
  private readonly base: string
  private readonly token: string
  private readonly resolve?: () => { url: string; token: string }
  private readonly timeoutMs?: number

  constructor(config: Pick<RunnerConfig, 'url' | 'token' | 'resolve'> & { timeoutMs?: number }) {
    this.base = config.url.replace(/\/+$/, '')
    this.token = config.token
    this.resolve = config.resolve
    this.timeoutMs = config.timeoutMs
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const current = this.resolve?.()
    const base = (current?.url ?? this.base).replace(/\/+$/, '')
    const token = current?.token ?? this.token
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(this.timeoutMs ? { signal: AbortSignal.timeout(this.timeoutMs) } : {}),
    })
    const text = await response.text()
    let value: unknown
    try {
      value = text ? JSON.parse(text) : undefined
    } catch {
      value = text
    }
    if (!response.ok) {
      const message =
        value && typeof value === 'object' && 'error' in value
          ? String((value as { error: unknown }).error)
          : `${method} ${path} failed with ${response.status}`
      throw new RunnerHttpError(response.status, message)
    }
    return value as T
  }

  /** Retry network and 5xx failures; a lease rejection is final. */
  private async requestRetry<T>(method: string, path: string, body?: unknown): Promise<T> {
    let last: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.request<T>(method, path, body)
      } catch (error) {
        last = error
        const retryable = !(error instanceof RunnerHttpError) || error.status >= 500
        if (!retryable || attempt === 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
      }
    }
    throw last
  }

  register(input: {
    id: string
    harness: string
    machine: string
    labels: string[]
    workspace: string
    capabilities: string[]
  }): Promise<{ id: string }> {
    return this.request('POST', '/v1/adapters/register', {
      id: input.id,
      harness: input.harness,
      role: 'runner',
      machine: input.machine,
      labels: input.labels,
      workspace: input.workspace,
      capabilities: input.capabilities,
    })
  }

  /** Adapter and runner registrations, optionally scoped to one workspace. */
  adapters(workspace?: string): Promise<EngineAdapterRow[]> {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    return this.request('GET', `/v1/adapters${query}`)
  }

  heartbeatAdapter(id: string): Promise<unknown> {
    return this.request('POST', `/v1/adapters/${encodeURIComponent(id)}/heartbeat`, {})
  }

  workNext(input: {
    workspace: string
    capabilities: string[]
    runner: { id: string; labels: string[] }
    limit: number
  }): Promise<ScriptWorkOrder[]> {
    return this.request('POST', '/v1/work/next', input)
  }

  heartbeat(order: ScriptWorkOrder): Promise<unknown> {
    return this.request(
      'POST',
      `/v1/runs/${order.run_id}/steps/${encodeURIComponent(order.step_path)}/heartbeat`,
      { work_token: order.work_token }
    )
  }

  output(order: ScriptWorkOrder, stream: 'stdout' | 'stderr', chunk: string): Promise<unknown> {
    return this.request(
      'POST',
      `/v1/runs/${order.run_id}/steps/${encodeURIComponent(order.step_path)}/output`,
      { work_token: order.work_token, stream, chunk }
    )
  }

  complete(order: ScriptWorkOrder, result: unknown, exitCode: number): Promise<unknown> {
    return this.requestRetry(
      'POST',
      `/v1/runs/${order.run_id}/steps/${encodeURIComponent(order.step_path)}/complete`,
      { work_token: order.work_token, result, exit_code: exitCode }
    )
  }

  fail(order: ScriptWorkOrder, error: string, exitCode?: number): Promise<unknown> {
    return this.requestRetry(
      'POST',
      `/v1/runs/${order.run_id}/steps/${encodeURIComponent(order.step_path)}/fail`,
      {
        work_token: order.work_token,
        error,
        ...(exitCode === undefined ? {} : { exit_code: exitCode }),
      }
    )
  }
}
