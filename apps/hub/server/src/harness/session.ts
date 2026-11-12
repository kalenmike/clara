import { bytesToBase64Url, base64UrlToBytes, randomBytes } from '@clara/crypto'
import type { AdapterAction, AdapterRequestAction, AdapterResponseState } from '@clara/shared-types'

type Pending = {
  controller: ReadableStreamDefaultController<Uint8Array>
  stream: ReadableStream<Uint8Array>
  resolve: (response: Response) => void
  reject: (cause: unknown) => void
  started: boolean
  cleanup: () => void
}

/**
 * One live adapter session. It turns the hub's Request into sealed adapter
 * frames and reconstructs the streamed Response. No adapter port is involved.
 *
 * Requests are cancellable: an abort is forwarded to the adapter as
 * `adapter.abort` so a timed-out probe or a closed browser stream cannot leave
 * the adapter, the hub, or the panel waiting forever.
 */
export class AdapterSessionBridge {
  private readonly send: (payload: AdapterAction) => void
  private readonly pending = new Map<string, Pending>()

  constructor(send: (payload: AdapterAction) => void) {
    this.send = send
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const id = bytesToBase64Url(randomBytes(12))
    const body = request.body ? await request.text() : undefined
    const signal = request.signal
    if (signal.aborted) throw abortError(signal)

    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    })
    const response = new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.cleanup()
        failPending(pending, abortError(signal))
        this.send({ type: 'adapter.abort', id })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        controller,
        stream,
        resolve,
        reject,
        started: false,
        cleanup: () => signal.removeEventListener('abort', onAbort),
      })
    })

    this.send({
      type: 'adapter.request',
      id,
      method: request.method as AdapterRequestAction['method'],
      path: url.pathname,
      ...(url.search ? { search: url.search } : {}),
      headers: Object.fromEntries(request.headers.entries()),
      ...(body === undefined ? {} : { body }),
    })
    return response
  }

  handleState(payload: AdapterResponseState): void {
    const pending = this.pending.get(payload.id)
    if (!pending) return
    switch (payload.type) {
      case 'adapter.response':
        pending.started = true
        pending.resolve(
          new Response(pending.stream, {
            status: payload.status,
            statusText: payload.statusText,
            headers: payload.headers,
          })
        )
        return
      case 'adapter.chunk':
        try {
          pending.controller.enqueue(base64UrlToBytes(payload.data))
        } catch {
          // The caller cancelled the response stream; stop the adapter request.
          this.finish(payload.id)
          this.send({ type: 'adapter.abort', id: payload.id })
        }
        return
      case 'adapter.end':
        try {
          pending.controller.close()
        } catch {
          // The stream may already be closed or errored.
        }
        this.finish(payload.id)
        return
      case 'adapter.error':
        failPending(pending, new Error(payload.message))
        this.finish(payload.id)
        return
    }
  }

  abortAll(): void {
    for (const pending of this.pending.values()) {
      pending.cleanup()
      failPending(pending, new Error('Adapter disconnected'))
    }
    this.pending.clear()
  }

  private finish(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    pending.cleanup()
    this.pending.delete(id)
  }
}

function failPending(pending: Pending, cause: unknown): void {
  try {
    if (pending.started) pending.controller.error(cause)
    else pending.reject(cause)
  } catch {
    // The stream may already be closed.
  }
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (reason && typeof reason === 'object') {
    const record = reason as { message?: unknown; name?: unknown }
    const error = new Error(
      typeof record.message === 'string' ? record.message : 'The request was aborted'
    )
    if (typeof record.name === 'string') error.name = record.name
    return error
  }
  const error = new Error('The request was aborted')
  error.name = 'AbortError'
  return error
}
