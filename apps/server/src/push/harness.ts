import type {
  ClaraForm,
  ClaraProject,
  ClaraSession,
  ClaraSessionMessage,
} from '@clara/api-contract'
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

export async function listProjects(client: HarnessRequest): Promise<ClaraProject[]> {
  try {
    return await getData<ClaraProject[]>(client, '/projects')
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

  const body = (await response.json()) as { data?: T }
  if (body.data === undefined) throw new Error(`Harness returned no data for ${path}`)
  return body.data
}
