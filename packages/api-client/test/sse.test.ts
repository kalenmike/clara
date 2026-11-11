import { describe, expect, it } from 'vitest'
import { ClaraApiError, createClaraClient } from '../src/index.ts'

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    {
      status,
      headers: { 'content-type': 'text/event-stream' },
    }
  )
}

describe('Clara API event stream', () => {
  it('parses split SSE frames and reports activity', async () => {
    let activity = 0
    const fetch = async (): Promise<Response> =>
      streamResponse([
        ': keepalive\n\n',
        'data: {"type":"session.idle","data":{"sessionID":"s1"}}\n',
        '\ndata: {"type":"session.updated","data":{"sessionID":"s1"}}\n\n',
      ])
    const client = createClaraClient({ fetch: fetch as typeof globalThis.fetch })

    const events: unknown[] = []
    for await (const event of client.event.subscribe({ onActivity: () => (activity += 1) })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'session.idle', data: { sessionID: 's1' } },
      { type: 'session.updated', data: { sessionID: 's1' } },
    ])
    expect(activity).toBe(3)
  })

  it('throws a typed error when the stream fails', async () => {
    const fetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { code: 'disabled', message: 'off' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    const client = createClaraClient({ fetch: fetch as typeof globalThis.fetch })

    const iterator = client.event.subscribe()[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toBeInstanceOf(ClaraApiError)
  })
})
