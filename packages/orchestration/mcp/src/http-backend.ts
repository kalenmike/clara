import type { ClaraBackend, UsageInput } from './types.ts'

export class HttpBackend implements ClaraBackend {
  readonly baseURL: string
  readonly token: string

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL.replace(/\/$/, '')
    this.token = token
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let parsed: unknown = undefined
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    if (!response.ok) {
      const error = parsed as { error?: { code?: string; message?: string } } | undefined
      throw new Error(error?.error?.message ?? `engine returned ${response.status}`)
    }
    return parsed
  }

  async start(input: {
    prompt: string
    workspace?: string
    target?: string
    capabilities?: string[]
    origin?: {
      session_id?: string | null
      harness?: string | null
      agent?: string | null
      workspace?: string | null
      machine?: string | null
      kind?: 'human' | 'agent' | 'api' | 'worker'
    }
  }) {
    return this.request('POST', '/v1/runs', input)
  }

  async next(runID: number, limit?: number, capabilities?: string[]) {
    return this.request('POST', `/v1/runs/${runID}/next`, {
      limit: limit ?? 1,
      ...(capabilities ? { capabilities } : {}),
    })
  }

  async complete(input: {
    run_id: number
    step_path: string
    work_token: string
    result: unknown
    usage?: UsageInput
    exit_code?: number
  }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/complete`,
      input
    )
  }

  async fail(input: {
    run_id: number
    step_path: string
    work_token: string
    error: string
    usage?: UsageInput
    exit_code?: number
    retry?: boolean
  }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/fail`,
      input
    )
  }

  async route(input: { run_id: number; step_path: string; work_token: string; route: string }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/route`,
      input
    )
  }

  async spawn(input: {
    run_id: number
    step_path: string
    work_token: string
    count: number
    prompt: string
    model?: string
    provider?: string
    policy?: unknown
    limits?: unknown
  }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/spawn`,
      input
    )
  }

  async status(runID: number) {
    return this.request('GET', `/v1/runs/${runID}`)
  }

  async attempts(runID: number, path?: string) {
    return this.request(
      'GET',
      path === undefined
        ? `/v1/runs/${runID}/attempts`
        : `/v1/runs/${runID}/steps/${encodeURIComponent(path)}/attempts`
    )
  }

  async list() {
    return this.request('GET', '/v1/runs')
  }

  async inbox() {
    return this.request('GET', '/v1/inbox')
  }

  async ack(alertID: number) {
    return this.request('POST', `/v1/alerts/${alertID}/ack`)
  }

  async cancel(runID: number, reason: string) {
    return this.request('POST', `/v1/runs/${runID}/cancel`, { reason })
  }

  async tick() {
    return this.request('POST', '/v1/tick')
  }

  async check(input: {
    run_id: number
    step_path: string
    action: string
    tool?: string
    resources?: string[]
    command?: string
    network?: string
    usage?: UsageInput
    work_token?: string
  }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/check`,
      input
    )
  }

  async usage(input: { run_id: number; step_path: string; work_token: string; usage: UsageInput }) {
    return this.request(
      'POST',
      `/v1/runs/${input.run_id}/steps/${encodeURIComponent(input.step_path)}/usage`,
      input
    )
  }

  async heartbeat(runID: number, stepPath: string, workToken: string) {
    return this.request(
      'POST',
      `/v1/runs/${runID}/steps/${encodeURIComponent(stepPath)}/heartbeat`,
      { work_token: workToken }
    )
  }

  async catalog(workspace?: string) {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    return this.request('GET', `/v1/catalog${query}`)
  }

  async registerAdapter(input: {
    harness: string
    role?: 'harness' | 'runner'
    machine?: string | null
    labels?: string[]
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }) {
    return this.request('POST', '/v1/adapters/register', input)
  }

  async adapters(workspace?: string) {
    return this.request(
      'GET',
      workspace ? `/v1/adapters?workspace=${encodeURIComponent(workspace)}` : '/v1/adapters'
    )
  }

  async heartbeatAdapter(id: string) {
    return this.request('POST', `/v1/adapters/${encodeURIComponent(id)}/heartbeat`)
  }

  async removeAdapter(id: string) {
    return this.request('DELETE', `/v1/adapters/${encodeURIComponent(id)}`)
  }
}
