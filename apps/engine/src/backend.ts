import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ClaraBackend, UsageInput } from '@clara/mcp'
import {
  catalogSummary,
  OrchestrationErrorWithCode,
  runSummary,
  Runtime,
  stepSummary,
  type StepRow,
} from '@clara/orchestration'

export class RuntimeBackend implements ClaraBackend {
  readonly runtime: Runtime
  readonly defaultWorkspace?: string

  constructor(runtime: Runtime, defaultWorkspace?: string) {
    this.runtime = runtime
    this.defaultWorkspace = defaultWorkspace
  }

  /**
   * Resolve a workspace string only. A runner serves a workspace on ITS own
   * machine, so the claim path must never stat the engine host's filesystem.
   */
  private resolveWorkspace(value?: string): string {
    const workspace = value ?? this.defaultWorkspace
    if (!workspace) {
      throw new OrchestrationErrorWithCode(
        'workspace_required',
        'The engine has no configured workspace.'
      )
    }
    return resolve(workspace)
  }

  /** Resolve a workspace the engine host itself must be able to read. */
  private requireWorkspace(value?: string): string {
    const resolved = this.resolveWorkspace(value)
    if (!existsSync(resolved)) {
      throw new OrchestrationErrorWithCode(
        'workspace_missing',
        `The workspace ${resolved} does not exist.`
      )
    }
    return resolved
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
      kind?: 'human' | 'agent' | 'api' | 'worker'
    }
  }) {
    const result = this.runtime.start({
      ...input,
      workspace: this.requireWorkspace(input.workspace),
    })
    return { ...result, run: runSummary(result.run) }
  }

  async next(runID: number, limit?: number, capabilities?: string[], harness?: string) {
    return this.runtime.next(runID, limit ?? 1, 'mcp', {
      ...(capabilities ? { capabilities } : {}),
      ...(harness ? { harness, role: 'harness' } : {}),
    })
  }

  async workNext(input: {
    workspace?: string
    capabilities: string[]
    runner?: { id: string; labels: string[]; machine?: string }
    limit?: number
  }) {
    return this.runtime.claimWork(
      this.resolveWorkspace(input.workspace),
      {
        capabilities: input.capabilities,
        role: 'runner',
        ...(input.runner ? { runner: input.runner } : {}),
      },
      input.limit ?? 1,
      'runner'
    )
  }

  async output(input: {
    run_id: number
    step_path: string
    work_token: string
    stream: 'stdout' | 'stderr'
    chunk: string
  }) {
    this.runtime.output(input.run_id, input.step_path, input.work_token, input.stream, input.chunk)
    return { ok: true }
  }

  async complete(input: {
    run_id: number
    step_path: string
    work_token: string
    result: unknown
    usage?: UsageInput
    exit_code?: number
  }) {
    const result = this.runtime.complete(
      input.run_id,
      input.step_path,
      input.work_token,
      input.result,
      input.usage,
      input.exit_code
    )
    return { ...result, run: runSummary(result.run) }
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
    const result = this.runtime.fail(
      input.run_id,
      input.step_path,
      input.work_token,
      input.error,
      input.usage,
      input.exit_code,
      input.retry === undefined ? undefined : { retry: input.retry }
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

  async claimDelivery(
    runID: number,
    input: { session_id?: string | null; terminal?: boolean; alert_ids?: number[] }
  ) {
    return this.runtime.claimDelivery(runID, input)
  }

  async releaseDelivery(runID: number, input: { terminal?: boolean; alert_ids?: number[] }) {
    this.runtime.releaseDelivery(runID, input)
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

  async catalog(workspace?: string) {
    return catalogSummary(this.runtime.catalogFor(this.requireWorkspace(workspace)))
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
