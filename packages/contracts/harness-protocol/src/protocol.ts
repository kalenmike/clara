import type { ClaraEvent } from '@clara/api-contract'
import type { HttpMethod } from '@clara/shared-types'

export const HARNESS_PROTOCOL_VERSION = 1
export const HARNESS_API_PREFIX = '/harness/v1'

export type HarnessInfo = {
  protocol: number
  adapter: { name: string; version: string; installedAt?: string }
  harness: { kind: string; version?: string }
  capabilities: HarnessCapabilities
}

export type HarnessCapabilities = Record<string, boolean | Record<string, boolean>>

export type HarnessRequestInput = {
  method: HttpMethod
  path: string
  search?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type HarnessErrorBody = {
  error?: { code?: string; message?: string }
  message?: string
}

export class HarnessClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HarnessClientError'
    this.status = status
    this.code = code
  }
}

export function harnessPath(path: string): string {
  return `${HARNESS_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

export function isHarnessInfo(value: unknown): value is HarnessInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.protocol === 'number' &&
    typeof record.adapter === 'object' &&
    record.adapter !== null &&
    typeof record.harness === 'object' &&
    record.harness !== null &&
    typeof record.capabilities === 'object' &&
    record.capabilities !== null
  )
}

/** Parse a Server-Sent Events stream emitted by an adapter. */
export async function* parseEventStream(
  stream: ReadableStream<Uint8Array>,
  onActivity?: () => void
): AsyncGenerator<ClaraEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onActivity?.()
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replaceAll('\r\n', '\n').replaceAll('\r', '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = block
          .split('\n')
          .flatMap((line) => (line.startsWith('data:') ? [line.slice(5).trimStart()] : []))
          .join('\n')
        if (data) yield JSON.parse(data) as ClaraEvent
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed.
    }
    reader.releaseLock()
  }
}
