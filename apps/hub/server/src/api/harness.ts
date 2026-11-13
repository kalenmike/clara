import type { HttpMethod } from '@clara/shared-types'
import {
  HarnessOfflineError,
  HarnessUnconfiguredError,
  type HarnessRequestInput,
} from '../harness/types.ts'
import { ApiRequestError, type ApiDependencies } from './context.ts'

export type ForwardRequest = {
  method: HttpMethod
  path: string
  search?: string
  headers?: Record<string, string>
  body?: string
}

export async function forward(
  deps: ApiDependencies,
  request: ForwardRequest,
  signal: AbortSignal
): Promise<Response> {
  if (!deps.canAccess()) {
    throw new ApiRequestError(403, 'disabled', 'Harness access is disabled by an admin setting')
  }
  if (!deps.harness.configured) {
    throw new ApiRequestError(
      503,
      'harness_unconfigured',
      'No harness adapter is configured. Add one in the hub panel.'
    )
  }

  try {
    return await deps.harness.request(toHarnessInput(request), signal)
  } catch (cause) {
    throw harnessError(cause)
  }
}

/** Forward a request to one specific paired harness. */
export async function forwardTo(
  deps: ApiDependencies,
  harnessID: string,
  request: ForwardRequest,
  signal: AbortSignal
): Promise<Response> {
  if (!deps.canAccess()) {
    throw new ApiRequestError(403, 'disabled', 'Harness access is disabled by an admin setting')
  }

  try {
    return await deps.harness.requestFor(harnessID, toHarnessInput(request), signal)
  } catch (cause) {
    throw harnessError(cause)
  }
}

function toHarnessInput(request: ForwardRequest): HarnessRequestInput {
  return {
    method: request.method,
    path: request.path,
    ...(request.search ? { search: request.search } : {}),
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.body === undefined ? {} : { body: request.body }),
  }
}

function harnessError(cause: unknown): never {
  if (cause instanceof HarnessUnconfiguredError) {
    throw new ApiRequestError(503, cause.code, cause.message)
  }
  if (cause instanceof HarnessOfflineError) {
    throw new ApiRequestError(503, cause.code, cause.message)
  }
  throw new ApiRequestError(
    502,
    'upstream_error',
    cause instanceof Error ? cause.message : String(cause)
  )
}

export async function forwardJson(
  deps: ApiDependencies,
  method: HttpMethod,
  path: string,
  body: unknown,
  signal: AbortSignal,
  search?: string
): Promise<Response> {
  return forward(
    deps,
    {
      method,
      path,
      ...(search ? { search } : {}),
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    },
    signal
  )
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiRequestError(502, 'upstream_invalid', 'The adapter returned invalid JSON')
  }
}

export async function forwardResult<T>(
  deps: ApiDependencies,
  request: ForwardRequest,
  signal: AbortSignal,
  unwrapData = false
): Promise<T> {
  return readForwardResult<T>(await forward(deps, request, signal), unwrapData)
}

export async function forwardResultTo<T>(
  deps: ApiDependencies,
  harnessID: string,
  request: ForwardRequest,
  signal: AbortSignal,
  unwrapData = false
): Promise<T> {
  return readForwardResult<T>(await forwardTo(deps, harnessID, request, signal), unwrapData)
}

async function readForwardResult<T>(response: Response, unwrapData: boolean): Promise<T> {
  if (!response.ok) throw await upstreamError(response)
  if (response.status === 204 || response.status === 205) return undefined as T
  const value = await readJson<unknown>(response)
  if (unwrapData && isRecord(value) && 'data' in value) return value.data as T
  return value as T
}

export async function upstreamError(response: Response): Promise<ApiRequestError> {
  const text = await response.text().catch(() => '')
  let message = text.trim()
  let code = 'upstream_error'

  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: unknown; message?: unknown }
        message?: unknown
      }
      if (parsed.error && typeof parsed.error === 'object') {
        if (typeof parsed.error.code === 'string') code = parsed.error.code
        if (typeof parsed.error.message === 'string') message = parsed.error.message
      } else if (typeof parsed.message === 'string') {
        message = parsed.message
      }
    } catch {
      // Keep the raw text as the message.
    }
  }

  if (response.status === 401 || response.status === 403) {
    return new ApiRequestError(
      502,
      'harness_auth',
      message || 'The harness adapter rejected the credentials'
    )
  }

  const status = response.status >= 500 ? 502 : response.status
  return new ApiRequestError(
    status,
    code,
    message || `The harness adapter responded with ${response.status}`
  )
}

export function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    appendQuery(search, key, value)
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/**
 * Location-scoped harness requests use a flat `directory` parameter. The
 * adapter is responsible for translating it into its harness's wire shape, so
 * callers must not leak OpenCode's nested `location[directory]` format here.
 */
export function locationQuery(
  directory: string | undefined,
  params: Record<string, unknown> = {}
): string {
  return query({ directory, ...params })
}

function appendQuery(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(search, key, item)
    return
  }
  if (typeof value === 'object') {
    for (const [child, item] of Object.entries(value)) {
      appendQuery(search, `${key}[${child}]`, item)
    }
    return
  }
  search.append(key, String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
