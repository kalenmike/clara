import { base64UrlToBytes } from '@clara/crypto'
import type { ClaraAction } from '@clara/shared-types'
import { SERVER_VERSION } from './version.ts'

export type HttpRequestAction = Extract<ClaraAction, { type: 'http.request' }>

export type OpenCodeProbe = {
  ok: boolean
  version?: string
  status?: number
  latencyMs: number
  code: 'ok' | 'timeout' | 'auth' | 'http' | 'unreachable' | 'disabled'
  message?: string
}

const MAX_BODY_BYTES = 10 * 1024 * 1024
const HOP_BY_HOP = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export class OpenCodeClient {
  private readonly baseUrl: URL
  private readonly password?: string

  constructor(url: string, password?: string) {
    this.baseUrl = new URL(url.replace(/\/+$/, ''))
    this.password = password
  }

  async request(action: HttpRequestAction, signal: AbortSignal): Promise<Response> {
    const target = new URL(`${action.path}${action.search ?? ''}`, this.baseUrl)
    if (target.origin !== this.baseUrl.origin) {
      throw new Error('Refusing to proxy a request to a different origin')
    }
    if (!target.pathname.startsWith('/api/')) {
      throw new Error('Refusing to proxy a path outside the OpenCode API')
    }

    const headers = new Headers(action.headers)
    for (const name of HOP_BY_HOP) headers.delete(name)
    headers.set('accept-encoding', 'identity')
    headers.set('user-agent', `clara-server/${SERVER_VERSION}`)
    if (this.password) {
      headers.set(
        'authorization',
        `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`
      )
    }

    let body: Uint8Array<ArrayBuffer> | undefined
    if (action.body) {
      body = base64UrlToBytes(action.body)
      if (body.byteLength > MAX_BODY_BYTES) throw new Error('Request body is too large')
    }

    return fetch(target, {
      method: action.method,
      headers,
      body,
      signal,
      redirect: 'manual',
    })
  }

  async probe(timeoutMs = 2_000): Promise<OpenCodeProbe> {
    const started = Date.now()
    try {
      const response = await this.request(
        { type: 'http.request', id: 'probe', method: 'GET', path: '/api/info' },
        AbortSignal.timeout(timeoutMs)
      )
      const latencyMs = Date.now() - started

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: response.status,
          latencyMs,
          code: 'auth',
          message: `OpenCode rejected the password (${response.status})`,
        }
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          latencyMs,
          code: 'http',
          message: `OpenCode responded with ${response.status}`,
        }
      }

      let version: string | undefined
      try {
        const info = (await response.json()) as { version?: unknown }
        if (typeof info.version === 'string') version = info.version
      } catch {
        // A reachable server that does not return JSON is still worth showing.
      }
      return { ok: true, latencyMs, code: 'ok', ...(version ? { version } : {}) }
    } catch (cause) {
      const latencyMs = Date.now() - started
      const timeout = isTimeout(cause)
      return {
        ok: false,
        latencyMs,
        code: timeout ? 'timeout' : 'unreachable',
        message: timeout ? `OpenCode did not answer within ${timeoutMs}ms` : errorMessage(cause),
      }
    }
  }

  async probeVersion(): Promise<string | undefined> {
    const result = await this.probe(3_000)
    return result.ok ? result.version : undefined
  }
}

function isTimeout(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const name = (cause as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Headers safe to forward into the browser Response after Node decompressed the body. */
export function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (name === 'content-encoding' || name === 'content-length' || name === 'transfer-encoding') {
      return
    }
    result[name] = value
  })
  return result
}
