import type { ClaraBackend, UsageInput } from '@clara/mcp-server'
import {
  catalogSummary,
  runSummary,
  Runtime,
  stepSummary,
  type StepRow,
} from '@clara/orchestration'

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
    const result = this.runtime.start(input)
    return { ...result, run: runSummary(result.run) }
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
    const result = this.runtime.complete(
      input.run_id,
      input.step_path,
      input.work_token,
      input.result,
      input.usage
    )
    return { ...result, run: runSummary(result.run) }
  }

  async fail(input: {
    run_id: number
    step_path: string
    work_token: string
    error: string
    usage?: UsageInput
  }) {
    const result = this.runtime.fail(
      input.run_id,
      input.step_path,
      input.work_token,
      input.error,
      input.usage
    )
    return { ...result, run: runSummary(result.run) }
  }

  async route(input: { run_id: number; step_path: string; work_token: string; route: string }) {
    const result = this.runtime.route(input.run_id, input.step_path, input.work_token, input.route)
    return { ...result, run: runSummary(result.run) }
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
    const result = this.runtime.spawn(input.run_id, input.step_path, input.work_token, {
      count: input.count,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.policy ? { policy: input.policy as never } : {}),
      ...(input.limits ? { limits: input.limits as never } : {}),
    })
    return {
      ...result,
      run: runSummary(result.run),
      children: result.children.map(runSummary),
    }
  }

  async status(runID: number) {
    const result = this.runtime.status(runID)
    return {
      ...result,
      run: runSummary(result.run),
      steps: result.steps.map(stepSummary),
      children: result.children.map(runSummary),
    }
  }

  async list() {
    return this.runtime.list().map(runSummary)
  }

  async pinned(runID: number) {
    return this.runtime.pinned(runID)
  }

  async step(runID: number, path: string): Promise<StepRow> {
    return this.runtime.stepDetail(runID, path)
  }

  async attempts(runID: number, path?: string) {
    return this.runtime.attempts(runID, path)
  }

  async inbox() {
    return this.runtime.inbox()
  }

  async ack(alertID: number) {
    this.runtime.ack(alertID)
    return { ok: true }
  }

  async cancel(runID: number, reason: string) {
    return runSummary(this.runtime.cancel(runID, reason))
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
    work_token?: string
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
      input.usage,
      input.work_token
    )
  }

  async usage(input: { run_id: number; step_path: string; work_token: string; usage: UsageInput }) {
    return this.runtime.usage(input.run_id, input.step_path, input.work_token, input.usage)
  }

  async heartbeat(runID: number, stepPath: string, workToken: string) {
    return this.runtime.heartbeat(runID, stepPath, workToken)
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
