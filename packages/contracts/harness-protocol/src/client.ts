import type { ClaraEvent } from '@clara/api-contract'
import {
  HARNESS_API_PREFIX,
  HarnessClientError,
  isHarnessInfo,
  parseEventStream,
  type HarnessErrorBody,
  type HarnessInfo,
  type HarnessRequestInput,
} from './protocol.ts'

export type HarnessFetch = (request: Request) => Promise<Response>

export type HarnessClientOptions = {
  fetch: HarnessFetch
  /** Base URL used by direct adapters. Omit for a session fetch shim. */
  baseUrl?: string
  token?: string
}

export class HarnessClient {
  private readonly options: HarnessClientOptions

  constructor(options: HarnessClientOptions) {
    this.options = options
  }

  async request(input: HarnessRequestInput): Promise<Response> {
    const url = new URL(
      `${HARNESS_API_PREFIX}${input.path}`,
      this.options.baseUrl ?? 'http://adapter'
    )
    if (input.search) url.search = input.search
    const headers = new Headers(input.headers)
    if (this.options.token) headers.set('authorization', `Bearer ${this.options.token}`)
    return this.options.fetch(
      new Request(url, {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.signal ? { signal: input.signal } : {}),
      })
    )
  }

  async json<T>(input: HarnessRequestInput): Promise<T> {
    const response = await this.request(input)
    if (!response.ok) throw await readError(response)
    if (response.status === 204 || response.status === 205) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  async info(signal?: AbortSignal): Promise<HarnessInfo> {
    const value = await this.json<unknown>({
      method: 'GET',
      path: '/info',
      ...(signal ? { signal } : {}),
    })
    if (!isHarnessInfo(value))
      throw new HarnessClientError(502, 'invalid_info', 'The adapter returned invalid info')
    return value
  }

  async events(signal: AbortSignal): Promise<AsyncGenerator<ClaraEvent>> {
    const response = await this.request({
      method: 'GET',
      path: '/events',
      headers: { accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok) throw await readError(response)
    if (!response.body)
      throw new HarnessClientError(502, 'no_stream', 'The adapter event stream has no body')
    return parseEventStream(response.body)
  }
}

export async function readError(response: Response): Promise<HarnessClientError> {
  const text = await response.text().catch(() => '')
  let code = 'harness_error'
  let message = text.trim() || `The adapter responded with ${response.status}`
  if (text) {
    try {
      const parsed = JSON.parse(text) as HarnessErrorBody
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
      else if (typeof parsed.message === 'string') message = parsed.message
    } catch {
      // Keep the raw text.
    }
  }
  return new HarnessClientError(response.status, code, message)
}
