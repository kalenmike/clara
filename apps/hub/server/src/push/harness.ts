import type { ClaraForm, ClaraSession, ClaraSessionMessage } from '@clara/api-contract'
import type { HarnessRequest } from '../harness/types.ts'

const REQUEST_TIMEOUT_MS = 5_000

export async function getSession(
  client: HarnessRequest,
  sessionID: string
): Promise<ClaraSession | null> {
  try {
    return await getData<ClaraSession>(client, `/sessions/${encodeURIComponent(sessionID)}`)
  } catch {
    return null
  }
}

export async function listRecentMessages(
  client: HarnessRequest,
  sessionID: string,
  type: 'user' | 'assistant'
): Promise<ClaraSessionMessage[]> {
  const search = new URLSearchParams({ order: 'desc', limit: '1', type }).toString()
  return getData<ClaraSessionMessage[]>(
    client,
    `/sessions/${encodeURIComponent(sessionID)}/messages`,
    `?${search}`
  )
}

export async function listForms(client: HarnessRequest, sessionID: string): Promise<ClaraForm[]> {
  try {
    return await getData<ClaraForm[]>(client, `/sessions/${encodeURIComponent(sessionID)}/forms`)
  } catch {
    return []
  }
}

export async function openEventStream(
  client: HarnessRequest,
  signal: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const response = await client.request(
    {
      method: 'GET',
      path: '/events',
      headers: { accept: 'text/event-stream' },
    },
    signal
  )

  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // The response body may already be closed.
    }
    throw new Error(`Harness event stream responded with ${response.status}`)
  }
  if (!response.body) throw new Error('Harness event stream has no body')
  return response.body
}

async function getData<T>(client: HarnessRequest, path: string, search?: string): Promise<T> {
  const response = await client.request(
    {
      method: 'GET',
      path,
      ...(search ? { search } : {}),
    },
    AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  )

  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // The response body may already be closed.
    }
    throw new Error(`Harness responded with ${response.status} for ${path}`)
  }

  // Adapters return the bare DTO for a session and a bare array for forms,
  // while a message page keeps its `{ data, cursor }` envelope. Unwrap only
  // when the body carries a data field so both shapes read the same.
  const value = (await response.json()) as unknown
  if (isRecord(value) && 'data' in value) return value.data as T
  if (value === undefined) throw new Error(`Harness returned no data for ${path}`)
  return value as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
