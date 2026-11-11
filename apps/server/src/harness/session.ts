import { bytesToBase64Url, base64UrlToBytes, randomBytes } from '@clara/crypto'
import type { AdapterAction, AdapterRequestAction, AdapterResponseState } from '@clara/shared-types'

type Pending = {
  controller: ReadableStreamDefaultController<Uint8Array>
  stream: ReadableStream<Uint8Array>
  resolve: (response: Response) => void
  reject: (cause: unknown) => void
  started: boolean
}

/**
 * One live adapter session. It turns the hub's Request into sealed adapter
 * frames and reconstructs the streamed Response. No adapter port is involved.
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

    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    })
    const response = new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { controller, stream, resolve, reject, started: false })
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
        pending.controller.enqueue(base64UrlToBytes(payload.data))
        return
      case 'adapter.end':
        pending.controller.close()
        this.pending.delete(payload.id)
        return
      case 'adapter.error':
        if (pending.started) pending.controller.error(new Error(payload.message))
        else pending.reject(new Error(payload.message))
        this.pending.delete(payload.id)
        return
    }
  }

  abortAll(): void {
    for (const pending of this.pending.values()) {
      try {
        if (pending.started) pending.controller.error(new Error('Adapter disconnected'))
        else pending.reject(new Error('Adapter disconnected'))
      } catch {
        // The stream may already be closed.
      }
    }
    this.pending.clear()
  }
}
