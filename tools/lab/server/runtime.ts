import { SERVER_INSTRUCTIONS } from '@clara/mcp'
import {
  previewPipeline,
  type AdapterInfo,
  type CompiledNode,
  type PreviewInput,
} from '@clara/pipeline-preview'
import { EventRelay } from './engine-events.ts'
import { McpClient, type ToolResult } from './mcp.ts'
import { LabState, workKey } from './state.ts'
import { resolveStepWiring } from './step-wiring.ts'
import type {
  AdapterRow,
  CancelAllResult,
  LabPreviewResult,
  PreflightResult,
  RunRow,
  StatusResult,
  StepDetail,
  StepRow,
  StepSummary,
  WorkOrder,
} from './types.ts'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function runIDOf(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const run = value.run
  if (isRecord(run) && typeof run.id === 'number') return run.id
  if (typeof value.id === 'number') return value.id
  return undefined
}

interface CompiledLike {
  kind?: string
  children?: CompiledLike[]
  routes?: Array<{ target?: CompiledLike }>
}

function pipelineStepCount(snapshot: string): number | undefined {
  try {
    const root = JSON.parse(snapshot) as CompiledLike
    if (root.kind !== 'pipeline') return undefined
    let count = 0
    const walk = (node: CompiledLike): void => {
      if (node.kind === 'agent' || node.kind === 'router' || node.kind === 'script') count++
      for (const child of node.children ?? []) walk(child)
      for (const route of node.routes ?? []) {
        if (route.target) walk(route.target)
      }
    }
    walk(root)
    return count
  } catch {
    return undefined
  }
}

export class LabRuntime {
  readonly state = new LabState()
  readonly mcp: McpClient
  private readonly url: string
  private readonly token: string
  private readonly events: EventRelay
  private heartbeatTimer: NodeJS.Timeout | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private beating = false
  private reconnectInFlight = false
  private adaptersLoaded = false

  constructor(options: { url: string; token: string; workspace: string }) {
    this.url = options.url
    this.token = options.token
    this.mcp = new McpClient(options.url, options.token)
    this.state.engine = options.url
    this.state.workspace = options.workspace
    this.state.tokenPresent = Boolean(options.token)
    this.state.instructions = SERVER_INSTRUCTIONS
    this.events = new EventRelay({
      url: options.url,
      token: options.token,
      onEvent: (event) => this.state.recordEvent(event),
      onConnection: (connected, error) => this.state.setConnection(connected, error),
    })
  }

  async start(): Promise<void> {
    try {
      await this.mcp.connect()
      this.state.setConnection(true)
      await this.loadTools()
      await this.loadConfig()
      this.events.start()
      await this.refreshAdapters(this.engineWorkspace()).catch(() => {})
    } catch (error) {
      this.state.setConnection(false, message(error))
    }
    this.heartbeatTimer = setInterval(() => void this.beat(), 10_000)
    this.heartbeatTimer.unref?.()
    this.retryTimer = setInterval(() => void this.ensureConnected(), 5_000)
    this.retryTimer.unref?.()
  }

  private async ensureConnected(): Promise<void> {
    if (this.mcp.connected || this.reconnectInFlight) return
    this.reconnectInFlight = true
    try {
      await this.mcp.connect()
      this.state.setConnection(true)
      await this.loadTools()
      await this.loadConfig()
      this.events.start()
      if (!this.adaptersLoaded) await this.refreshAdapters(this.engineWorkspace())
    } catch (error) {
      this.state.setConnection(false, message(error))
    } finally {
      this.reconnectInFlight = false
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.retryTimer = undefined
    await this.events.stop()
    await this.mcp.disconnect()
  }

  async reconnect(): Promise<void> {
    if (this.reconnectInFlight) return
    this.reconnectInFlight = true
    await this.events.stop()
    await this.mcp.disconnect()
    try {
      await this.mcp.connect()
      this.state.setConnection(true)
      await this.loadTools()
      await this.loadConfig()
      this.events.start()
      await this.refreshAdapters(this.engineWorkspace())
    } catch (error) {
      this.state.setConnection(false, message(error))
      throw error
    } finally {
      this.reconnectInFlight = false
    }
  }

  private async loadTools(): Promise<void> {
    try {
      const tools = await this.mcp.tools()
      this.state.setTools(tools, SERVER_INSTRUCTIONS)
    } catch (error) {
      this.state.setConnection(false, message(error))
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch(`${this.url}/v1/config`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) return
      const value = (await response.json()) as { workspace?: unknown }
      this.state.setEngineWorkspace(
        typeof value.workspace === 'string' ? value.workspace.trim() : ''
      )
    } catch {
      // Offline is normal; preflight reports the connection state.
    }
  }

  private engineWorkspace(): string {
    return this.state.engineWorkspace || this.state.workspace
  }

  async preview(input: PreviewInput): Promise<LabPreviewResult> {
    if (this.mcp.connected && !this.adaptersLoaded) {
      await this.refreshAdapters(this.engineWorkspace()).catch(() => {})
    }
    return previewPipeline({
      ...input,
      adapters: this.adapterInfo(),
    })
  }

  async preflight(input: {
    hostWorkspace: string
    runtimeWorkspace?: string
    target?: string
  }): Promise<PreflightResult> {
    const hostWorkspace = input.hostWorkspace.trim() || this.state.workspace
    if (!this.state.engineWorkspace && !input.runtimeWorkspace?.trim()) {
      await this.loadConfig()
    }
    const runtimeWorkspace =
      input.runtimeWorkspace?.trim() || this.state.engineWorkspace || hostWorkspace
    const target = input.target?.trim() || undefined
    const result: PreflightResult = {
      host: { ok: false },
      runtime: { ok: false },
      adapter: { required: false, ok: true },
    }

    try {
      const preview = await this.preview({
        workspace: hostWorkspace,
        ...(target ? { target } : {}),
      })
      const errors = preview.diagnostics.filter((entry) => entry.severity === 'error')
      const warnings = preview.diagnostics.filter((entry) => entry.severity === 'warning')
      const strict = preview.compiled?.root.enforcement === 'strict'
      result.host = {
        ok: Boolean(preview.compiled) && errors.length === 0,
        packages: preview.catalog?.packages.length ?? 0,
        errors: errors.length,
        warnings: warnings.length,
        strict,
        ...(preview.workspace
          ? {
              workspace: preview.workspace.workspace,
              configPath: preview.workspace.configPath,
            }
          : {}),
        ...(target ? { target } : {}),
        ...(preview.selected ? { targetLabel: preview.selected.label } : {}),
        ...(!preview.compiled && errors[0] ? { error: errors[0].message } : {}),
      }
      if (strict && preview.compiled) {
        const leaves: CompiledNode[] = []
        const collect = (node: CompiledNode): void => {
          if (node.kind === 'agent' || node.kind === 'router' || node.kind === 'script') {
            leaves.push(node)
          }
          for (const child of node.children ?? []) collect(child)
          for (const route of node.routes ?? []) {
            if (route.target) collect(route.target)
          }
        }
        collect(preview.compiled.root)
        const extra = preview.compiled.root.requires?.capabilities ?? []
        const harness = preview.compiled.root.requires?.adapter
        const needsAgent = leaves.some((leaf) => leaf.kind === 'agent' || leaf.kind === 'router')
        const needsScript = leaves.some((leaf) => leaf.kind === 'script')
        const live = this.adapterInfo()
        const has = (role: 'harness' | 'runner', capabilities: string[]): boolean =>
          live.some(
            (adapter) =>
              (adapter.role ?? 'harness') === role &&
              (!harness || role !== 'harness' || adapter.harness === harness) &&
              [...capabilities, ...extra].every((capability) =>
                adapter.capabilities.includes(capability)
              )
          )
        const agentOK = !needsAgent || has('harness', ['tool_policy', 'turn_limit', 'token_limit'])
        const scriptOK = !needsScript || has('runner', ['script'])
        const required = [
          ...(needsAgent ? ['tool_policy', 'turn_limit', 'token_limit'] : []),
          ...(needsScript ? ['script'] : []),
          ...extra,
        ]
        result.adapter = {
          required: required.length > 0,
          ok: agentOK && scriptOK,
          capabilities: required,
        }
      }
    } catch (error) {
      result.host = { ok: false, error: message(error) }
    }

    if (!this.mcp.connected) {
      result.runtime = { ok: false, error: 'The engine is not connected.' }
      return result
    }

    try {
      const catalog = await this.getJson<unknown[]>(
        `/v1/catalog?workspace=${encodeURIComponent(runtimeWorkspace)}`
      )
      result.runtime = {
        ok: true,
        packages: Array.isArray(catalog) ? catalog.length : 0,
      }
    } catch (error) {
      result.runtime = { ok: false, error: message(error) }
    }

    return result
  }

  adapterInfo(): AdapterInfo[] {
    return this.state.adapters.map((adapter) => ({
      id: adapter.id,
      harness: adapter.harness,
      ...(adapter.role ? { role: adapter.role } : {}),
      ...(adapter.machine ? { machine: adapter.machine } : {}),
      ...(adapter.labels ? { labels: capabilities(adapter.labels) } : {}),
      ...(adapter.workspace ? { workspace: adapter.workspace } : {}),
      capabilities: capabilities(adapter.capabilities),
      ...(adapter.heartbeat_at ? { heartbeat_at: adapter.heartbeat_at } : {}),
    }))
  }

  async refreshAdapters(workspace: string): Promise<void> {
    if (!this.mcp.connected) return
    const result = await this.callTool('clara_adapters', { workspace }, 'system')
    this.adaptersLoaded = true
    if (Array.isArray(result.value)) {
      this.state.setAdapters(result.value as AdapterRow[])
    }
  }

  async runStatus(runID: number): Promise<ToolResult> {
    const result = await this.callTool('clara_status', { run_id: runID }, 'ui')
    if (result.isError || !isRecord(result.value) || !isRecord(result.value.run)) return result
    const id = Number(result.value.run.id)
    if (!Number.isInteger(id)) return result
    const stepCount = await this.pinnedStepCount(id).catch(() => undefined)
    return {
      ...result,
      value: { ...result.value, ...(stepCount === undefined ? {} : { stepCount }) },
    }
  }

  async cancelAll(): Promise<CancelAllResult> {
    const listed = await this.callTool('clara_list', {}, 'ui')
    const rows = Array.isArray(listed.value) ? (listed.value as RunRow[]) : []
    const terminal = new Set(['completed', 'failed', 'cancelled'])
    const targets = rows.filter(
      (row) =>
        !terminal.has(row.state) && (row.root_run_id === undefined || row.root_run_id === row.id)
    )
    const failed: CancelAllResult['failed'] = []
    let cancelled = 0
    for (const row of targets) {
      try {
        const result = await this.callTool(
          'clara_cancel',
          { run_id: row.id, reason: 'cancelled all from Clara Lab' },
          'ui'
        )
        if (result.isError) {
          failed.push({
            id: row.id,
            error: typeof result.value === 'string' ? result.value : JSON.stringify(result.value),
          })
        } else {
          cancelled++
        }
      } catch (error) {
        failed.push({ id: row.id, error: message(error) })
      }
    }
    return { cancelled, failed }
  }

  pinnedSnapshot(runID: number): Promise<{ run_id: number; hash: string; snapshot: string }> {
    return this.getJson(`/v1/runs/${runID}/snapshot`)
  }

  async stepDetail(runID: number, stepPath: string): Promise<StepDetail> {
    const [step, pinned, status] = await Promise.all([
      this.getJson<StepRow>(`/v1/runs/${runID}/steps/${encodeURIComponent(stepPath)}`),
      this.pinnedSnapshot(runID).catch(() => undefined),
      this.getJson<StatusResult>(`/v1/runs/${runID}`).catch(() => undefined),
    ])
    const wiring = resolveStepWiring(pinned?.snapshot, stepPath, status?.steps ?? [])
    return { ...step, ...wiring }
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>('GET', path)
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.requestJson<T>('POST', path, body)
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = (await response.json()) as unknown
    if (!response.ok) {
      const error = isRecord(value) && isRecord(value.error) ? value.error : undefined
      throw new Error(
        typeof error?.message === 'string'
          ? error.message
          : `engine returned ${response.status}`
      )
    }
    return value as T
  }

  private async pinnedStepCount(runID: number): Promise<number | undefined> {
    const pinned = await this.pinnedSnapshot(runID)
    return pipelineStepCount(pinned.snapshot)
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    source: 'ui' | 'heartbeat' | 'system' | 'stream' = 'ui'
  ): Promise<ToolResult> {
    const started = Date.now()
    try {
      // Starting a run is an operator action: the Lab is the only caller that
      // selects a workspace and pipeline target. Model-facing MCP always uses
      // the configured entry point.
      const result =
        name === 'clara_start'
          ? { value: await this.postJson('/v1/runs', args), isError: false }
          : await this.mcp.call(name, args)
      this.state.recordCall({
        tool: name,
        source,
        args,
        result: result.value,
        isError: result.isError,
        durationMs: Date.now() - started,
      })
      this.state.setConnection(true)
      this.reconcileTool(name, args, result.value)
      return result
    } catch (error) {
      const text = message(error)
      this.state.recordCall({
        tool: name,
        source,
        args,
        error: text,
        durationMs: Date.now() - started,
      })
      this.state.setConnection(false, text)
      throw error
    }
  }

  private reconcileTool(name: string, args: Record<string, unknown>, value: unknown): void {
    if (name === 'clara_start') {
      const order = isRecord(value) ? value.work : undefined
      if (Array.isArray(order)) {
        for (const item of order) this.state.addWork(item as WorkOrder, 'start')
      }
      return
    }

    if (name === 'clara_next' && Array.isArray(value)) {
      for (const item of value) this.state.addWork(item as WorkOrder, 'next')
      return
    }

    if (
      name === 'clara_complete' ||
      name === 'clara_fail' ||
      name === 'clara_route' ||
      name === 'clara_spawn'
    ) {
      const runID = Number(args.run_id)
      const stepPath = typeof args.step_path === 'string' ? args.step_path : undefined
      if (Number.isInteger(runID) && stepPath) {
        this.state.removeWork(workKey(runID, stepPath))
      }
      return
    }

    if (name === 'clara_cancel') {
      const runID = Number(args.run_id)
      if (Number.isInteger(runID)) this.state.removeRun(runID)
      return
    }

    if (name === 'clara_status' && isRecord(value) && Array.isArray(value.steps)) {
      this.reconcileStatus(Number(args.run_id), value.steps as StepSummary[])
      return
    }

    if (name === 'clara_adapters' && Array.isArray(value)) {
      this.state.setAdapters(value as AdapterRow[])
      return
    }

    if (name === 'clara_adapter_register' || name === 'clara_adapter_remove') {
      void this.refreshAdapters(this.engineWorkspace()).catch(() => {})
    }

    if (name === 'clara_start' || name === 'clara_complete') {
      const runID = runIDOf(value)
      if (runID) this.state.emit('state', { run: runID })
    }
  }

  private reconcileStatus(runID: number, steps: StepSummary[]): void {
    if (!Number.isInteger(runID)) return
    const byPath = new Map(steps.map((step) => [step.path, step]))
    for (const record of this.state.listWork()) {
      if (record.order.run_id !== runID) continue
      const step = byPath.get(record.order.step_path)
      if (!step || step.status !== 'running' || step.attempt !== record.order.attempt) {
        this.state.removeWork(record.key)
      }
    }
  }

  async registerAdapter(workspace: string): Promise<ToolResult> {
    return this.callTool(
      'clara_adapter_register',
      {
        harness: 'clara-lab',
        workspace,
        capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
      },
      'ui'
    )
  }

  async removeAdapter(id: string): Promise<ToolResult> {
    return this.callTool('clara_adapter_remove', { id }, 'ui')
  }

  async violation(runID: number, stepPath: string, reason: string): Promise<unknown> {
    const started = Date.now()
    try {
      const response = await fetch(
        `${this.url}/v1/runs/${runID}/steps/${encodeURIComponent(stepPath)}/violation`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ reason }),
        }
      )
      const value = (await response.json()) as unknown
      this.state.recordCall({
        tool: 'violation',
        source: 'ui',
        args: { run_id: runID, step_path: stepPath, reason },
        result: value,
        isError: !response.ok,
        durationMs: Date.now() - started,
      })
      return value
    } catch (error) {
      const text = message(error)
      this.state.recordCall({
        tool: 'violation',
        source: 'ui',
        args: { run_id: runID, step_path: stepPath, reason },
        error: text,
        durationMs: Date.now() - started,
      })
      throw error
    }
  }

  private async beat(): Promise<void> {
    if (!this.state.heartbeat || !this.mcp.connected || this.beating) return
    this.beating = true
    try {
      for (const record of this.state.listWork()) {
        try {
          await this.callTool(
            'clara_heartbeat',
            {
              run_id: record.order.run_id,
              step_path: record.order.step_path,
              work_token: record.order.work_token,
            },
            'heartbeat'
          )
          this.state.markHeartbeat(record.key)
        } catch {
          this.state.removeWork(record.key)
        }
      }
      for (const adapter of this.state.adapters) {
        try {
          await this.callTool('clara_adapter_heartbeat', { id: adapter.id }, 'heartbeat')
        } catch {
          // A stale adapter is expected after a service restart; the next
          // register call replaces it.
        }
      }
    } finally {
      this.beating = false
    }
  }
}
