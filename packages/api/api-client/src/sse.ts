import type { ClaraEvent } from '@clara/api-contract'
import type { ClaraEventSubscribeOptions } from './types.ts'
import { ClaraApiError } from './errors.ts'

export async function* subscribeEvents(
  fetch: typeof globalThis.fetch,
  baseUrl: string,
  options: ClaraEventSubscribeOptions = {}
): AsyncIterable<ClaraEvent> {
  const url = new URL('/v1/events', baseUrl)
  if (options.harnessID) url.searchParams.set('harnessID', options.harnessID)
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...headersToRecord(options.headers),
      accept: 'text/event-stream',
    },
    signal: options.signal,
  })

  if (!response.ok) throw await ClaraApiError.from(response)
  if (!response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      options.onActivity?.()
      buffer += decoder.decode(value, { stream: true })

      let boundary = nextBoundary(buffer)
      while (boundary) {
        const chunk = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const event = parseEvent(chunk)
        if (event) yield event
        boundary = nextBoundary(buffer)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function nextBoundary(value: string): { index: number; length: number } | null {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

function parseEvent(chunk: string): ClaraEvent | undefined {
  const data: string[] = []
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return undefined
  const text = data.join('\n')
  if (!text) return undefined
  try {
    return JSON.parse(text) as ClaraEvent
  } catch {
    return undefined
  }
}

function headersToRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers as Record<string, string | undefined>)) {
    if (value !== undefined) result[key] = value
  }
  return result
}
