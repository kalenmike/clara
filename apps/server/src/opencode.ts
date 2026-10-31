import { base64UrlToBytes } from '@clara/crypto'
import type { ClaraAction } from '@clara/shared-types'
import { SERVER_VERSION } from './version.ts'

export type HttpRequestAction = Extract<ClaraAction, { type: 'http.request' }>

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

  async probeVersion(): Promise<string | undefined> {
    try {
      const response = await this.request(
        { type: 'http.request', id: 'probe', method: 'GET', path: '/api/info' },
        AbortSignal.timeout(3_000)
      )
      if (!response.ok) return undefined
      const info = (await response.json()) as { version?: unknown }
      return typeof info.version === 'string' ? info.version : undefined
    } catch {
      return undefined
    }
  }
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
