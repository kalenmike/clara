import type {
  AlertRow,
  CancelAllResult,
  CompiledDiff,
  LabPreviewResult,
  LabSnapshot,
  OpenCodeSessionsResult,
  PreflightResult,
  RunRow,
  StatusResult,
  StepDetail,
  ToolEnvelope,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const text = await response.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const failure = body as ErrorBody | undefined
    throw new ApiError(
      response.status,
      failure?.error?.code ?? 'request_failed',
      failure?.error?.message ?? `Clara Lab returned ${response.status}`
    )
  }
  return body as T
}

function mutation(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-clara-lab': '1',
    },
    body: JSON.stringify(body ?? {}),
  }
}

export function getState(): Promise<LabSnapshot> {
  return request<LabSnapshot>('/api/state')
}

export interface PreviewRequest {
  workspace?: string
  target?: string
  configPath?: string
  stdDir?: string
}

export function preview(input: PreviewRequest): Promise<LabPreviewResult> {
  return request<LabPreviewResult>('/api/preview', mutation(input))
}

export interface PreflightRequest {
  hostWorkspace: string
  runtimeWorkspace?: string
  target?: string
}

export function preflight(input: PreflightRequest): Promise<PreflightResult> {
  return request<PreflightResult>('/api/preflight', mutation(input))
}

export function pickDirectory(initial?: string): Promise<{ path: string | null }> {
  return request<{ path: string | null }>('/api/pick-directory', mutation({ initial }))
}

export function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolEnvelope<T>> {
  return request<ToolEnvelope<T>>(`/api/tools/${encodeURIComponent(name)}`, mutation(args))
}

export function getRuns(): Promise<ToolEnvelope<RunRow[]>> {
  return request<ToolEnvelope<RunRow[]>>('/api/runs')
}

export function getRun(id: number): Promise<ToolEnvelope<StatusResult>> {
  return request<ToolEnvelope<StatusResult>>(`/api/runs/${id}`)
}

export function getStep(runID: number, stepPath: string): Promise<StepDetail> {
  return request<StepDetail>(`/api/runs/${runID}/steps/${encodeURIComponent(stepPath)}`)
}

export function getInbox(): Promise<ToolEnvelope<AlertRow[]>> {
  return request<ToolEnvelope<AlertRow[]>>('/api/inbox')
}

export function getOpenCodeSessions(): Promise<OpenCodeSessionsResult> {
  return request<OpenCodeSessionsResult>('/api/opencode/sessions')
}

export function reconnectOpenCode(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/opencode/reconnect', mutation({}))
}

export function cancelAllRuns(): Promise<CancelAllResult> {
  return request<CancelAllResult>('/api/runs/cancel-all', mutation({}))
}

export interface SourceResponse {
  path: string
  text: string
  truncated: boolean
  bytes: number
}

export function getSource(path: string): Promise<SourceResponse> {
  return request<SourceResponse>(`/api/source?path=${encodeURIComponent(path)}`)
}

export interface DiffRequest extends PreviewRequest {
  run_id: number
}

export interface DiffResponse {
  currentHash: string
  runHash?: string
  diff: CompiledDiff
}

export function getDiff(input: DiffRequest): Promise<DiffResponse> {
  return request<DiffResponse>('/api/diff', mutation(input))
}

export function setHeartbeat(enabled: boolean): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>('/api/heartbeat', mutation({ enabled }))
}

export function reconnect(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/reconnect', mutation({}))
}

export function registerAdapter(workspace: string): Promise<ToolEnvelope> {
  return request<ToolEnvelope>('/api/adapter/register', mutation({ workspace }))
}

export function removeAdapter(id: string): Promise<ToolEnvelope> {
  return request<ToolEnvelope>('/api/adapter/remove', mutation({ id }))
}

export function violation(runID: number, stepPath: string, reason: string): Promise<ToolEnvelope> {
  return request<ToolEnvelope>(
    '/api/violation',
    mutation({ run_id: runID, step_path: stepPath, reason })
  )
}

export function streamURL(): string {
  return '/api/stream'
}
