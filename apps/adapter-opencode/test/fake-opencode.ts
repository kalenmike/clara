export type CapturedRequest = {
  method: string
  url: URL
  headers: Headers
  body: string | undefined
  signal: AbortSignal | undefined
}

export type FakeFetch = typeof globalThis.fetch

export function createFakeFetch(
  handler: (request: CapturedRequest) => Response | Promise<Response>
): { fetch: FakeFetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = []
  const fetch: FakeFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const request: CapturedRequest = {
      method: init?.method ?? 'GET',
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    }
    requests.push(request)
    return handler(request)
  }
  return { fetch, requests }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}
