import type { ServiceConfig } from './config.ts'

export class EngineRequestError extends Error {
  readonly code?: string
  readonly status: number

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'EngineRequestError'
    this.status = status
    if (code) this.code = code
  }
}

/** One JSON request to the local engine. */
export async function requestEngine<T = unknown>(
  config: ServiceConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = undefined
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!response.ok) {
    const error = parsed as { error?: { code?: string; message?: string } } | undefined
    throw new EngineRequestError(
      response.status,
      error?.error?.message ?? `Clara engine returned ${response.status}`,
      error?.error?.code
    )
  }
  return parsed as T
}
