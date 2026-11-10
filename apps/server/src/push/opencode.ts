import type { FormInfo, Project, SessionInfo, SessionMessageInfo } from '@opencode/client'
import type { HarnessRequest } from '../harness/types.ts'

const REQUEST_TIMEOUT_MS = 5_000

export async function getSession(
  client: HarnessRequest,
  sessionID: string
): Promise<SessionInfo | null> {
  try {
    return await getData<SessionInfo>(client, `/api/session/${encodeURIComponent(sessionID)}`)
  } catch {
    return null
  }
}

export async function listRecentMessages(
  client: HarnessRequest,
  sessionID: string,
  type: 'user' | 'assistant'
): Promise<SessionMessageInfo[]> {
  const search = new URLSearchParams({ order: 'desc', limit: '1', type }).toString()
  return getData<SessionMessageInfo[]>(
    client,
    `/api/session/${encodeURIComponent(sessionID)}/message`,
    `?${search}`
  )
}

export async function listForms(client: HarnessRequest, sessionID: string): Promise<FormInfo[]> {
  try {
    return await getData<FormInfo[]>(client, `/api/session/${encodeURIComponent(sessionID)}/form`)
  } catch {
    return []
  }
}

export async function listProjects(client: HarnessRequest): Promise<Project[]> {
  try {
    return await getData<Project[]>(client, '/api/project')
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
      type: 'http.request',
      id: 'push-events',
      method: 'GET',
      path: '/api/event',
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
    throw new Error(`OpenCode event stream responded with ${response.status}`)
  }
  if (!response.body) throw new Error('OpenCode event stream has no body')
  return response.body
}

async function getData<T>(client: HarnessRequest, path: string, search?: string): Promise<T> {
  const response = await client.request(
    {
      type: 'http.request',
      id: 'push-data',
      method: 'GET',
      path,
      search,
    },
    AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  )

  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // The response body may already be closed.
    }
    throw new Error(`OpenCode responded with ${response.status} for ${path}`)
  }

  const body = (await response.json()) as { data?: T }
  if (body.data === undefined) throw new Error(`OpenCode returned no data for ${path}`)
  return body.data
}
