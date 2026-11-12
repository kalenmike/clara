import type { Context } from 'hono'

export const MAX_BODY_BYTES = 10 * 1024 * 1024

export async function jsonBody<T>(c: Context, maxBytes = MAX_BODY_BYTES): Promise<T> {
  try {
    const text = await c.req.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Request body is too large')
    return (text ? JSON.parse(text) : {}) as T
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Request body is too large') throw cause
    return {} as T
  }
}

export function booleanQuery(c: Context, name: string): boolean | undefined {
  const value = c.req.query(name)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function numberQuery(c: Context, name: string): number | undefined {
  const value = c.req.query(name)
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
