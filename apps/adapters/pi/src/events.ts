import type { ClaraEvent } from '@clara/api-contract'

const KEEPALIVE_MS = 15_000

/** One process-wide event stream shared by every hub subscription. */
export class EventBus {
  private readonly subscribers = new Set<(event: ClaraEvent) => void>()

  subscribe(listener: (event: ClaraEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  publish(event: ClaraEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event)
      } catch {
        // A broken subscription must not stop the run.
      }
    }
  }

  stream(signal: AbortSignal): Response {
    const encoder = new TextEncoder()
    const controller = new AbortController()
    let closed = false
    let lastCommentAt = Date.now()

    const abort = () => controller.abort()
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abort, { once: true })

    const stream = new ReadableStream<Uint8Array>({
      start: (target) => {
        const send = (text: string) => {
          if (closed) return
          try {
            target.enqueue(encoder.encode(text))
          } catch {
            closed = true
          }
        }
        const comment = () => {
          const now = Date.now()
          if (now - lastCommentAt < KEEPALIVE_MS) return
          lastCommentAt = now
          send(':\n\n')
        }
        const unsubscribe = this.subscribe((event) => {
          send(`data: ${JSON.stringify(event)}\n\n`)
        })
        const keepalive = setInterval(comment, KEEPALIVE_MS)
        keepalive.unref?.()

        const cleanup = () => {
          unsubscribe()
          clearInterval(keepalive)
          signal.removeEventListener('abort', abort)
        }
        controller.signal.addEventListener('abort', () => {
          if (closed) return
          closed = true
          cleanup()
          try {
            target.close()
          } catch {
            // Already closed.
          }
        })
        lastCommentAt = Date.now()
        send(':\n\n')
      },
      cancel: () => {
        closed = true
        controller.abort()
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  }
}
