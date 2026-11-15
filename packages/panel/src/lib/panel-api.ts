export type PanelApiErrorInfo = {
  status: number
  code?: string
  message: string
}

export class PanelApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(info: PanelApiErrorInfo) {
    super(info.message)
    this.name = 'PanelApiError'
    this.status = info.status
    this.code = info.code
  }
}

/** A single panel API request, described so a host can carry it over another transport. */
export type PanelApiRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  headers: Record<string, string>
  body?: string
  credentials: 'same-origin'
  cache: 'no-store'
  /** Cancels the request, for example when a poll is superseded or unmounted. */
  signal?: AbortSignal
}

export type PanelApiRequestOptions = {
  signal?: AbortSignal
}

/**
 * Sends one panel API request and resolves with its raw response. The default
 * transport fetches a relative path from the panel's own origin, so cookies and
 * the `x-clara-panel` guard keep working.
 */
export type PanelApiTransport = (request: PanelApiRequest) => Promise<Response>

export function fetchPanelApi(request: PanelApiRequest): Promise<Response> {
  return fetch(request.path, {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    body: request.body,
    cache: request.cache,
    signal: request.signal,
  })
}

let panelApiTransport: PanelApiTransport = fetchPanelApi

/** Replace the panel API transport; pass `null` to restore same-origin fetch. */
export function configurePanelApi(transport: PanelApiTransport | null = null): void {
  panelApiTransport = transport ?? fetchPanelApi
}

export async function getPanel<T>(path: string, options: PanelApiRequestOptions = {}): Promise<T> {
  const response = await panelApiTransport({
    method: 'GET',
    path,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  })
  if (!response.ok) throw await errorFor(response)
  return (await response.json()) as T
}

export async function postPanel<T = void>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

export async function patchPanel<T = void>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}

export async function deletePanel<T = void>(path: string, body?: unknown): Promise<T> {
  return request<T>('DELETE', path, body)
}

async function request<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const response = await panelApiTransport({
    method,
    path,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-clara-panel': '1',
    },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (!response.ok) throw await errorFor(response)
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function errorFor(response: Response): Promise<PanelApiError> {
  let code: string | undefined
  let message = `The panel request failed (${response.status}).`
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // Fall through to the status.
  }
  return new PanelApiError({ status: response.status, code, message })
}
