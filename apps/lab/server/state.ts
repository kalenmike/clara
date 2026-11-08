import type {
  AdapterRow,
  CallRecord,
  LabSnapshot,
  OpenCodeSummary,
  OrcEvent,
  StreamItem,
  ToolInfo,
  WorkOrder,
  WorkRecord,
} from './types.ts'

const MAX_CALLS = 600
const MAX_EVENTS = 2_000

export function workKey(runID: number, stepPath: string): string {
  return `${runID}:${stepPath}`
}

export class LabState {
  private readonly calls: CallRecord[] = []
  private readonly events: OrcEvent[] = []
  private readonly work = new Map<string, WorkRecord>()
  private readonly listeners = new Set<(item: StreamItem) => void>()
  private sequence = 0

  connected = false
  heartbeat = true
  tokenPresent = false
  orchestrator = ''
  workspace = ''
  orchestratorWorkspace = ''
  instructions = ''
  tools: ToolInfo[] = []
  adapters: AdapterRow[] = []
  opencode: OpenCodeSummary = {
    connected: false,
    reachable: false,
    url: '',
    sessionCount: 0,
    activeCount: 0,
    auth: {
      present: false,
      source: 'default',
      serviceFile: '',
    },
    updatedAt: new Date().toISOString(),
  }
  lastError: string | undefined

  setConnection(connected: boolean, error?: string): void {
    this.connected = connected
    this.lastError = error
    this.emit('state', { connected, lastError: error })
  }

  setTokenPresent(present: boolean): void {
    this.tokenPresent = present
  }

  setOrchestratorWorkspace(workspace: string): void {
    if (workspace === this.orchestratorWorkspace) return
    this.orchestratorWorkspace = workspace
    this.emit('state', { orchestratorWorkspace: workspace })
  }

  setHeartbeat(enabled: boolean): void {
    this.heartbeat = enabled
    this.emit('state', { heartbeat: enabled })
  }

  setTools(tools: ToolInfo[], instructions: string): void {
    this.tools = tools
    this.instructions = instructions
    this.emit('state', { tools, instructions })
  }

  setAdapters(adapters: AdapterRow[]): void {
    this.adapters = adapters
    this.emit('state', { adapters })
  }

  setOpenCode(opencode: OpenCodeSummary): void {
    this.opencode = opencode
    this.emit('state', { opencode })
  }

  addWork(order: WorkOrder, source: WorkRecord['source']): WorkRecord {
    const key = workKey(order.run_id, order.step_path)
    const record: WorkRecord = {
      key,
      order,
      claimedAt: new Date().toISOString(),
      heartbeats: 0,
      source,
    }
    this.work.set(key, record)
    this.emit('state', { work: this.listWork() })
    return record
  }

  markHeartbeat(key: string): void {
    const record = this.work.get(key)
    if (!record) return
    record.heartbeats++
    record.lastHeartbeatAt = new Date().toISOString()
    this.emit('state', { work: this.listWork() })
  }

  removeWork(key: string): void {
    if (this.work.delete(key)) this.emit('state', { work: this.listWork() })
  }

  removeRun(runID: number): void {
    let changed = false
    for (const key of this.work.keys()) {
      if (key.startsWith(`${runID}:`)) {
        this.work.delete(key)
        changed = true
      }
    }
    if (changed) this.emit('state', { work: this.listWork() })
  }

  listWork(): WorkRecord[] {
    return [...this.work.values()].sort((left, right) =>
      left.claimedAt.localeCompare(right.claimedAt)
    )
  }

  getWork(key: string): WorkRecord | undefined {
    return this.work.get(key)
  }

  recordCall(call: Omit<CallRecord, 'id' | 'at'>): CallRecord {
    const record: CallRecord = {
      ...call,
      id: ++this.sequence,
      at: new Date().toISOString(),
    }
    this.calls.push(record)
    if (this.calls.length > MAX_CALLS) this.calls.splice(0, this.calls.length - MAX_CALLS)
    this.emit('call', record)
    return record
  }

  recordEvent(event: OrcEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.reconcile(event)
    this.emit('event', event)
  }

  private reconcile(event: OrcEvent): void {
    const step = typeof event.payload.step === 'string' ? event.payload.step : undefined
    if (
      step &&
      [
        'step.completed',
        'step.failed',
        'step.routed',
        'step.spawned',
        'step.retry',
        'watchdog.retry',
      ].includes(event.type)
    ) {
      this.removeWork(workKey(event.run_id, step))
    }
    if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) {
      this.removeRun(event.run_id)
    }
  }

  emit(type: StreamItem['type'], data: unknown): void {
    const item: StreamItem = {
      seq: ++this.sequence,
      type,
      at: new Date().toISOString(),
      data,
    }
    for (const listener of this.listeners) listener(item)
  }

  subscribe(listener: (item: StreamItem) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): LabSnapshot {
    return {
      workspace: this.workspace,
      orchestratorWorkspace: this.orchestratorWorkspace,
      orchestrator: this.orchestrator,
      connected: this.connected,
      tokenPresent: this.tokenPresent,
      heartbeat: this.heartbeat,
      work: this.listWork(),
      calls: [...this.calls],
      events: [...this.events],
      adapters: this.adapters,
      instructions: this.instructions,
      tools: this.tools,
      opencode: this.opencode,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }
}
