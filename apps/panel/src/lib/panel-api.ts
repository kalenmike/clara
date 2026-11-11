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

export async function getPanel<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
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
