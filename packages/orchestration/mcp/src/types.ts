export interface OriginInput {
  session_id?: string | null
  harness?: string | null
  agent?: string | null
  /** Absolute workspace on the caller's machine. */
  workspace?: string | null
  /** Machine name of the host running the calling adapter. */
  machine?: string | null
  kind?: 'human' | 'agent' | 'api' | 'worker'
}

export interface UsageInput {
  turns?: number
  tokens?: number
  /** Cache-weighted tokens for budget enforcement; falls back to `tokens`. */
  budgetTokens?: number
  toolCalls?: number
  violations?: number
}

export interface ClaraBackend {
  start(input: {
    prompt: string
    workspace?: string
    target?: string
    capabilities?: string[]
    origin?: OriginInput
  }): Promise<unknown>
  next(runID: number, limit?: number, capabilities?: string[]): Promise<unknown>
  complete(input: {
    run_id: number
    step_path: string
    work_token: string
    result: unknown
    usage?: UsageInput
    exit_code?: number
  }): Promise<unknown>
  fail(input: {
    run_id: number
    step_path: string
    work_token: string
    error: string
    usage?: UsageInput
    exit_code?: number
    retry?: boolean
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
  attempts(runID: number, path?: string): Promise<unknown>
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
    work_token?: string
  }): Promise<unknown>
  usage(input: {
    run_id: number
    step_path: string
    work_token: string
    usage: UsageInput
  }): Promise<unknown>
  heartbeat(runID: number, stepPath: string, workToken: string): Promise<unknown>
  catalog(workspace?: string): Promise<unknown>
  registerAdapter(input: {
    harness: string
    role?: 'harness' | 'runner'
    machine?: string | null
    labels?: string[]
    workspace: string
    session_id?: string | null
    capabilities: string[]
    id?: string
  }): Promise<unknown>
  adapters(workspace?: string): Promise<unknown>
  heartbeatAdapter(id: string): Promise<unknown>
  removeAdapter(id: string): Promise<unknown>
}
