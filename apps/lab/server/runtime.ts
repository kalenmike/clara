import { SERVER_INSTRUCTIONS } from '@clara/mcp-server'
import {
  previewPipeline,
  type AdapterInfo,
  type PreviewInput,
  type PreviewResult,
} from '@clara/devtools'
import { EventRelay } from './orchestrator-events.ts'
import { McpClient, type ToolResult } from './mcp.ts'
import { LabState, workKey } from './state.ts'
import type { AdapterRow, PreflightResult, StepRow, WorkOrder } from './types.ts'

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
    this.state.orchestrator = options.url
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
      this.events.start()
      await this.refreshAdapters(this.state.workspace).catch(() => {})
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
      this.events.start()
      if (!this.adaptersLoaded) await this.refreshAdapters(this.state.workspace)
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
      this.events.start()
      await this.refreshAdapters(this.state.workspace)
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

  async preview(input: PreviewInput): Promise<PreviewResult> {
    if (this.mcp.connected && !this.adaptersLoaded) {
      await this.refreshAdapters(input.workspace ?? this.state.workspace).catch(() => {})
    }
    return previewPipeline({ ...input, adapters: this.adapterInfo() })
  }

  async preflight(input: {
    hostWorkspace: string
    runtimeWorkspace: string
    target?: string
  }): Promise<PreflightResult> {
    const hostWorkspace = input.hostWorkspace.trim() || this.state.workspace
    const runtimeWorkspace = input.runtimeWorkspace.trim() || hostWorkspace
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
        const required = preview.compiled.root.requires?.capabilities ?? [
          'tool_policy',
          'turn_limit',
          'token_limit',
        ]
        const harness = preview.compiled.root.requires?.adapter
        const match = this.adapterInfo().find(
          (adapter) =>
            (!harness || adapter.harness === harness) &&
            required.every((capability) => adapter.capabilities.includes(capability))
        )
        result.adapter = {
          required: true,
          ok: Boolean(match),
          ...(match ? { id: match.id } : {}),
          capabilities: required,
        }
      }
    } catch (error) {
      result.host = { ok: false, error: message(error) }
    }

    if (!this.mcp.connected) {
      result.runtime = { ok: false, error: 'The orchestrator is not connected.' }
      return result
    }

    try {
      const catalog = await this.callTool(
        'clara_catalog',
        { workspace: runtimeWorkspace },
        'system'
      )
      if (catalog.isError) {
        result.runtime = {
          ok: false,
          error: typeof catalog.value === 'string' ? catalog.value : JSON.stringify(catalog.value),
        }
      } else {
        result.runtime = {
          ok: true,
          packages: Array.isArray(catalog.value) ? catalog.value.length : 0,
        }
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

  async callTool(
    name: string,
    args: Record<string, unknown>,
    source: 'ui' | 'heartbeat' | 'system' | 'stream' = 'ui'
  ): Promise<ToolResult> {
    const started = Date.now()
    try {
      const result = await this.mcp.call(name, args)
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
      this.reconcileStatus(Number(args.run_id), value.steps as StepRow[])
      return
    }

    if (name === 'clara_adapters' && Array.isArray(value)) {
      this.state.setAdapters(value as AdapterRow[])
      return
    }

    if (name === 'clara_adapter_register' || name === 'clara_adapter_remove') {
      void this.refreshAdapters(this.state.workspace).catch(() => {})
    }

    if (name === 'clara_start' || name === 'clara_complete') {
      const runID = runIDOf(value)
      if (runID) this.state.emit('state', { run: runID })
    }
  }

  private reconcileStatus(runID: number, steps: StepRow[]): void {
    if (!Number.isInteger(runID)) return
    const byPath = new Map(steps.map((step) => [step.path, step]))
    for (const record of this.state.listWork()) {
      if (record.order.run_id !== runID) continue
      const step = byPath.get(record.order.step_path)
      if (!step || step.status !== 'running' || step.lease_id !== record.order.work_token) {
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
            { run_id: record.order.run_id, step_path: record.order.step_path },
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
