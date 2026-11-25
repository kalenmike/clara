import type { PreviewResult } from '@clara/pipeline-preview/types'

export type { PreviewResult }
export type { CompiledNode, CompiledRoute } from '@clara/pipeline-preview/types'

export type LabPreviewResult = PreviewResult
export type {
  AdapterInfo,
  CompiledDiff,
  CompiledPreview,
  Diagnostic,
  NodeChange,
  PackageEntryInfo,
  PreviewStats,
  SourceRef,
  TargetInfo,
} from '@clara/pipeline-preview/types'

export interface StepInput {
  label: string
  path: string
  name: string
  status?: string
  result: unknown
}

export interface StepArtifact {
  label: string
  path: string
  exists?: boolean
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

export interface WorkOrder {
  run_id: number
  step_path: string
  name: string
  kind: string
  prompt?: string
  work_token: string
  attempt: number
  max_attempts: number
  model?: string
  provider?: string
  policy?: Record<string, unknown>
  limits?: Record<string, unknown>
  budget?: Record<string, number>
  enforcement: string
  background: boolean
  script?: ScriptSpec
  routes?: Array<{ when: string; run: string; criteria?: string; description?: string }>
  context: {
    prompt: string
    inputs: StepInput[]
    artifacts: StepArtifact[]
    failure?: {
      step: string
      attempt: number
      error?: string
      result?: unknown
    }
  }
}

export interface WorkRecord {
  key: string
  order: WorkOrder
  claimedAt: string
  lastHeartbeatAt?: string
  heartbeats: number
  source: 'start' | 'next' | 'restored'
}

export interface CallRecord {
  id: number
  at: string
  tool: string
  source: 'ui' | 'heartbeat' | 'system' | 'stream'
  args: unknown
  result?: unknown
  error?: string
  isError?: boolean
  durationMs: number
}

export interface OrcEvent {
  id: number
  run_id: number
  type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AdapterRow {
  id: string
  harness: string
  session_id: string | null
  workspace: string
  capabilities: string
  heartbeat_at: string
  created_at: string
}

export interface ToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface CancelAllResult {
  cancelled: number
  failed: Array<{ id: number; error: string }>
}

export interface LabSnapshot {
  workspace: string
  engineWorkspace: string
  engine: string
  connected: boolean
  tokenPresent: boolean
  heartbeat: boolean
  work: WorkRecord[]
  calls: CallRecord[]
  events: OrcEvent[]
  adapters: AdapterRow[]
  instructions: string
  tools: ToolInfo[]
  lastError?: string
}

export interface RunRow {
  id: number
  workspace: string
  prompt: string
  target: string
  state: string
  root_run_id: number
  parent_run_id: number | null
  parent_step_path: string | null
  origin_session_id: string | null
  origin_harness: string | null
  origin_agent: string | null
  origin_workspace?: string | null
  origin_machine?: string | null
  origin_kind: string
  pipeline_ref: string
  hash: string
  enforcement: string
  notification: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
  error: string | null
}

export interface StepRow {
  id: number
  run_id: number
  path: string
  parent_path: string | null
  name: string
  type: string
  status: string
  attempt: number
  max_attempts: number
  prompt: string | null
  model: string | null
  provider: string | null
  policy: string | null
  limits: string | null
  background: number
  result: string | null
  error: string | null
  recovery_cycles: number
  recovered: number
  recovered_by: string | null
  lease_id: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  started_at: string | null
  finished_at: string | null
  turns: number
  tokens: number
  tool_calls: number
  violations: number
  created_at: string
  updated_at: string
}

export type StepSummary = Omit<
  StepRow,
  'prompt' | 'policy' | 'limits' | 'lease_id' | 'lease_owner' | 'lease_expires_at'
>

export interface StepDetail extends StepRow {
  inputs: StepInput[]
  artifacts: StepArtifact[]
  request: boolean
}

export interface AlertRow {
  id: number
  run_id: number
  step_path: string | null
  kind: string
  title: string
  body: string
  status: string
  created_at: string
  resolved_at: string | null
}

export interface StatusResult {
  run: RunRow
  steps: StepSummary[]
  alerts: AlertRow[]
  children: RunRow[]
  stepCount?: number
}

export interface ToolEnvelope<T = unknown> {
  ok: boolean
  isError: boolean
  value: T
}

export interface PreflightHostCheck {
  ok: boolean
  workspace?: string
  configPath?: string
  packages?: number
  target?: string
  targetLabel?: string
  strict?: boolean
  errors?: number
  warnings?: number
  error?: string
}

export interface PreflightRuntimeCheck {
  ok: boolean
  packages?: number
  error?: string
}

export interface PreflightAdapterCheck {
  required: boolean
  ok: boolean
  id?: string
  capabilities?: string[]
}

export interface PreflightResult {
  host: PreflightHostCheck
  runtime: PreflightRuntimeCheck
  adapter: PreflightAdapterCheck
}

export interface StreamItem<T = unknown> {
  seq: number
  type: 'call' | 'event' | 'state' | 'preview' | 'snapshot'
  at: string
  data: T
}
