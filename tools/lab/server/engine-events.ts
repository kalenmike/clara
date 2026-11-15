import type { OrcEvent } from './types.ts'

export interface EventRelayOptions {
  url: string
  token: string
  onEvent: (event: OrcEvent) => void
  onConnection: (connected: boolean, error?: string) => void
}

/**
 * Subscribes to the engine's SSE feed and keeps the last event id so a
 * reconnect resumes instead of replaying the whole run history.
 */
export class EventRelay {
  private readonly options: EventRelayOptions
  private stopped = true
  private cursor = 0
  private controller: AbortController | undefined
  private loop: Promise<void> | undefined

  constructor(options: EventRelayOptions) {
    this.options = options
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.loop = this.run()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.controller?.abort()
    await this.loop?.catch(() => {})
    this.options.onConnection(false)
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.streamOnce()
      } catch (error) {
        if (this.stopped) return
        this.options.onConnection(false, error instanceof Error ? error.message : String(error))
      }
      if (this.stopped) return
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }

  private async streamOnce(): Promise<void> {
    this.controller = new AbortController()
    const response = await fetch(`${this.options.url}/v1/events?since=${this.cursor}`, {
      headers: this.options.token ? { authorization: `Bearer ${this.options.token}` } : {},
      signal: this.controller.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`event stream returned ${response.status}`)
    }
    this.options.onConnection(true)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        this.handleChunk(chunk)
        boundary = buffer.indexOf('\n\n')
      }
    }
  }

  private handleChunk(chunk: string): void {
    let id = this.cursor
    let type = 'event'
    const data: string[] = []
    for (const line of chunk.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('id:')) {
        const parsed = Number(line.slice(3).trim())
        if (Number.isFinite(parsed)) id = parsed
      } else if (line.startsWith('event:')) {
        type = line.slice(6).trim() || 'event'
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart())
      }
    }
    if (!data.length) return
    this.cursor = id
    try {
      const payload = JSON.parse(data.join('\n')) as Record<string, unknown>
      this.options.onEvent({
        id,
        run_id: Number(payload.run_id ?? 0),
        type,
        payload,
        created_at:
          typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString(),
      })
    } catch {
      // Ignore malformed frames; the next event resumes from the cursor.
    }
  }
}
