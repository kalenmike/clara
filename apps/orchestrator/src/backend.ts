import type { ClaraBackend, UsageInput } from '@clara/mcp-server'
import { catalogSummary, Runtime } from '@clara/orchestration'

export class RuntimeBackend implements ClaraBackend {
  readonly runtime: Runtime

  constructor(runtime: Runtime) {
    this.runtime = runtime
  }

  async start(input: {
    prompt: string
    workspace: string
    target?: string
    origin?: {
      session_id?: string | null
      harness?: string | null
      agent?: string | null
      kind?: 'human' | 'agent' | 'api' | 'worker'
    }
  }) {
    return this.runtime.start(input)
  }

  async next(runID: number, limit?: number) {
    return this.runtime.next(runID, limit ?? 1, 'mcp')
  }

  async complete(input: {
    run_id: number
    step_path: string
    work_token: string
    result: unknown
    usage?: UsageInput
  }) {
    return this.runtime.complete(
      input.run_id,
      input.step_path,
      input.work_token,
      input.result,
      input.usage
    )
  }

  async fail(input: {
    run_id: number
    step_path: string
    work_token: string
    error: string
    usage?: UsageInput
  }) {
    return this.runtime.fail(
      input.run_id,
      input.step_path,
      input.work_token,
      input.error,
      input.usage
    )
  }

  async route(input: { run_id: number; step_path: string; work_token: string; route: string }) {
    return this.runtime.route(input.run_id, input.step_path, input.work_token, input.route)
  }

  async spawn(input: {
    run_id: number
    step_path: string
    work_token: string
    count: number
    prompt: string
    model?: string
    policy?: unknown
    limits?: unknown
  }) {
    return this.runtime.spawn(input.run_id, input.step_path, input.work_token, {
      count: input.count,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.policy ? { policy: input.policy as never } : {}),
      ...(input.limits ? { limits: input.limits as never } : {}),
    })
  }

  async status(runID: number) {
    return this.runtime.status(runID)
  }

  async list() {
    return this.runtime.list()
  }

  async inbox() {
    return this.runtime.inbox()
  }

  async ack(alertID: number) {
    this.runtime.ack(alertID)
    return { ok: true }
  }

  async cancel(runID: number, reason: string) {
    return this.runtime.cancel(runID, reason)
  }

  async tick() {
    return this.runtime.tick()
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
  }) {
    return this.runtime.check(
      input.run_id,
      input.step_path,
      {
        action: input.action,
        ...(input.tool ? { tool: input.tool } : {}),
        ...(input.resources ? { resources: input.resources } : {}),
        ...(input.command ? { command: input.command } : {}),
        ...(input.network ? { network: input.network } : {}),
      },
      input.usage
    )
  }

  async usage(input: { run_id: number; step_path: string; usage: UsageInput }) {
    return this.runtime.usage(input.run_id, input.step_path, input.usage)
  }

  async heartbeat(runID: number, stepPath: string) {
    this.runtime.heartbeat(runID, stepPath)
    return { ok: true }
  }

  async catalog(workspace: string) {
    return catalogSummary(this.runtime.catalogFor(workspace))
  }

  async registerAdapter(input: {
    harness: string
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }) {
    return this.runtime.registerAdapter(input)
  }

  async adapters(workspace?: string) {
    return this.runtime.adapters(workspace)
  }

  async heartbeatAdapter(id: string) {
    this.runtime.heartbeatAdapter(id)
    return { ok: true }
  }

  async removeAdapter(id: string) {
    this.runtime.removeAdapter(id)
    return { ok: true }
  }
}
