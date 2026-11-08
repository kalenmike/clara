export interface OriginInput {
  session_id?: string | null
  harness?: string | null
  agent?: string | null
  kind?: 'human' | 'agent' | 'api' | 'worker'
}

export interface UsageInput {
  turns?: number
  tokens?: number
  toolCalls?: number
  violations?: number
}

export interface ClaraBackend {
  start(input: {
    prompt: string
    workspace: string
    target?: string
    origin?: OriginInput
  }): Promise<unknown>
  next(runID: number, limit?: number): Promise<unknown>
  complete(input: {
    run_id: number
    step_path: string
    work_token: string
    result: unknown
    usage?: UsageInput
  }): Promise<unknown>
  fail(input: {
    run_id: number
    step_path: string
    work_token: string
    error: string
    usage?: UsageInput
  }): Promise<unknown>
  route(input: {
    run_id: number
    step_path: string
    work_token: string
    route: string
  }): Promise<unknown>
  spawn(input: {
    run_id: number
    step_path: string
    work_token: string
    count: number
    prompt: string
    model?: string
    provider?: string
    policy?: unknown
    limits?: unknown
  }): Promise<unknown>
  status(runID: number): Promise<unknown>
  list(): Promise<unknown>
  inbox(): Promise<unknown>
  ack(alertID: number): Promise<unknown>
  cancel(runID: number, reason: string): Promise<unknown>
  tick(): Promise<unknown>
  check(input: {
    run_id: number
    step_path: string
    action: string
    tool?: string
    resources?: string[]
    command?: string
    network?: string
    usage?: UsageInput
  }): Promise<unknown>
  usage(input: { run_id: number; step_path: string; usage: UsageInput }): Promise<unknown>
  heartbeat(runID: number, stepPath: string): Promise<unknown>
  catalog(workspace: string): Promise<unknown>
  registerAdapter(input: {
    harness: string
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }): Promise<unknown>
  adapters(workspace?: string): Promise<unknown>
  heartbeatAdapter(id: string): Promise<unknown>
  removeAdapter(id: string): Promise<unknown>
}
