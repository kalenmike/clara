import { afterEach, describe, expect, it } from 'vitest'
import { configureLabApi, getLabTransport, type LabTransport } from '../src/api'
import { runStream, type SseMessage } from '../src/useLab'

const original = getLabTransport()

afterEach(() => {
  configureLabApi(original)
})

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

interface Outcome {
  seen: SseMessage[]
  steps: string[]
  signal: AbortSignal
}

/** Run one connection and abort as soon as the stream closes. */
async function runToClose(
  overrides: Partial<LabTransport> = {},
  chunks: string[] = []
): Promise<Outcome> {
  const controller = new AbortController()
  const seen: SseMessage[] = []
  const steps: string[] = []
  configureLabApi({
    fetch: overrides.fetch ?? (() => Promise.resolve(new Response(null))),
    stream: overrides.stream ?? (() => Promise.resolve(new Response(body(chunks)))),
    basePath: overrides.basePath,
  })
  await runStream(
    {
      message: (message) => seen.push(message),
      open: () => steps.push('open'),
      close: () => {
        steps.push('close')
        controller.abort()
      },
    },
    controller.signal
  )
  return { seen, steps, signal: controller.signal }
}

describe('runStream', () => {
  it('reads server frames split across chunks', async () => {
    const frame = 'retry: 40\n\nevent: snapshot\ndata: {"seq":0}\n\n: heartbeat\n\n'
    const { seen, steps, signal } = await runToClose({}, [
      frame.slice(0, 12),
      frame.slice(12, 40),
      frame.slice(40),
    ])

    expect(seen).toEqual([
      { event: 'message', data: '', id: null, retry: 40 },
      { event: 'snapshot', data: '{"seq":0}', id: null, retry: null },
    ])
    expect(steps).toEqual(['open', 'close'])
    expect(signal.aborted).toBe(true)
  })

  it('reports a failed connection and reconnects until aborted', async () => {
    let attempts = 0
    const { steps } = await runToClose({
      stream: () => {
        attempts += 1
        return Promise.resolve(new Response('nope', { status: 503 }))
      },
    })

    expect(attempts).toBe(1)
    expect(steps).toEqual(['close'])
  })

  it('requests the event stream with the right headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    await runToClose({
      stream: (input, init) => {
        calls.push({ url: String(input), init })
        return Promise.resolve(new Response(body(['event: preview\ndata: {}\n\n'])))
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/stream')
    expect(calls[0]?.init?.headers).toEqual({ accept: 'text/event-stream' })
    expect(calls[0]?.init?.cache).toBe('no-store')
  })

  it('streams through the hub bridge base path', async () => {
    const urls: string[] = []
    await runToClose({
      basePath: '/v1/lab',
      stream: (input) => {
        urls.push(String(input))
        return Promise.resolve(new Response(body(['event: preview\ndata: {}\n\n'])))
      },
    })

    expect(urls).toEqual(['/v1/lab/stream'])
  })
})
