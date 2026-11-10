/** Options for one embedded or standalone Clara script runner. */
export interface RunnerConfig {
  /** Orchestrator base URL, for example http://127.0.0.1:8789. */
  url: string
  /** Orchestrator bearer token. */
  token: string
  /** Absolute workspace path the runner executes in. */
  workspace: string
  /** Stable runner id. Defaults to host/pid based. */
  id?: string
  /** Labels used to satisfy a step's `requires.runner`. */
  labels?: string[]
  /** Machine name reported to the orchestrator. Defaults to os.hostname(). */
  machine?: string
  /** Maximum concurrent script processes. Defaults to 2. */
  concurrency?: number
  /** Capabilities advertised to the orchestrator. Defaults to ["script"]. */
  capabilities?: string[]
  /** Step-lease heartbeat interval. Defaults to 10s. */
  heartbeatMs?: number
  /** Idle claim interval. Defaults to 1s. */
  pollMs?: number
  /** Runner registration heartbeat interval. Defaults to 30s. */
  adapterHeartbeatMs?: number
  logger?: RunnerLogger
}

export interface RunnerLogger {
  log(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface ScriptSpec {
  command: string
  interpreter?: string
  cwd?: string
  env?: Record<string, string>
  passEnv?: string[]
  timeoutSeconds?: number
  successCodes?: number[]
  resultMode?: 'auto' | 'json' | 'text' | 'exit' | 'tail'
  maxOutputBytes?: number
}

export interface WorkInput {
  label: string
  path: string
  name: string
  result: unknown
}

export interface WorkArtifact {
  label: string
  path: string
  exists?: boolean
}

/** The script subset of an orchestrator work order. */
export interface ScriptWorkOrder {
  run_id: number
  step_path: string
  name: string
  kind: 'script'
  workspace: string
  work_token: string
  attempt: number
  max_attempts: number
  enforcement: string
  background: boolean
  script: ScriptSpec
  context: {
    prompt: string
    inputs: WorkInput[]
    artifacts: WorkArtifact[]
  }
}

export interface RunnerStatus {
  id: string
  workspace: string
  registered: boolean
  active: number
  completed: number
  failed: number
  lastError?: string
}
