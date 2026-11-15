import type {
  AlertRow,
  CancelAllResult,
  CompiledDiff,
  LabPreviewResult,
  LabSnapshot,
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

/**
 * Where Clara Lab sends its requests.
 *
 * The lab API always calls relative UI paths (`/api/state`, `/api/stream`, …).
 * The transport resolves them, so the same UI can run against the standalone
 * lab server (default, same-origin) or against a hub bridge that exposes the lab
 * API under another prefix, for example `/v1/lab` behind the paired session.
 * `stream` defaults to `fetch`.
 */
export interface LabTransport {
  /** Performs every lab API request. It resolves the path it receives. */
  fetch: typeof globalThis.fetch
  /** Fetch used for the event stream. Defaults to `fetch`. */
  stream?: typeof globalThis.fetch
  /**
   * Prefix applied to lab API paths. Empty (the default) keeps `/api/...` for
   * the standalone lab; `/v1/lab` maps `/api/state` to `/v1/lab/state`.
   */
  basePath?: string
}

const API_PREFIX = '/api'

const sameOriginFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)

const defaultTransport: LabTransport = {
  fetch: sameOriginFetch,
  stream: sameOriginFetch,
  basePath: '',
}

let activeTransport: LabTransport = defaultTransport

/** Install the transport used by every lab API call and by the event stream. */
export function configureLabApi(transport: LabTransport | null): void {
  activeTransport = transport
    ? { ...transport, basePath: normalizeBasePath(transport.basePath) }
    : defaultTransport
}

/** The transport currently in use, so consumers can share the stream fetch. */
export function getLabTransport(): LabTransport {
  return activeTransport
}

function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Map a lab UI path onto the active transport.
 *
 * With no base path the path is returned unchanged. With `/v1/lab`,
 * `/api/state` becomes `/v1/lab/state` and `/api/source?path=x` becomes
 * `/v1/lab/source?path=x`. Paths outside `/api` are left alone.
 */
export function resolveLabPath(path: string): string {
  const basePath = activeTransport.basePath ?? ''
  if (!basePath) return path
  if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return path
  return `${basePath}${path.slice(API_PREFIX.length)}`
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await activeTransport.fetch(resolveLabPath(path), { cache: 'no-store', ...init })
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

/** The fetch used for the event stream: the transport's `stream`, else its `fetch`. */
export function streamFetch(): typeof globalThis.fetch {
  return activeTransport.stream ?? activeTransport.fetch
}
