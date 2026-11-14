import { createServer, type Server } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { parseWireFrame, type WireFrame } from '@clara/shared-types'
import type { Agent } from './agent.ts'
import type { ApiApp } from './api/context.ts'

export type LocalTransportOptions = {
  host: string
  port: number
  agent: Agent
  api: ApiApp
  /** Shared across restarts so outbound frames keep reaching new clients. */
  sockets: Set<WebSocket>
  /** Called after a successful bind with the actual port. */
  onBound?: (port: number) => void
  log?: (message: string, detail?: unknown) => void
}

export type LocalTransportStatus = {
  active: boolean
  connections: number
}

const CLOSE_GRACE_MS = 250

/**
 * The local WebSocket listener owns one HTTP server and one WebSocketServer.
 * It can be stopped and started again without recreating the Agent or its
 * socket set, which keeps the transport switch independent of E2EE sessions.
 */
export class LocalTransport {
  private readonly options: LocalTransportOptions
  private server: Server | undefined
  private wss: WebSocketServer | undefined
  private running = false
  private boundPort: number | undefined

  constructor(options: LocalTransportOptions) {
    this.options = options
  }

  get active(): boolean {
    return this.running
  }

  /** The actual port, including a port the OS chose for an ephemeral bind. */
  get port(): number {
    return this.boundPort ?? this.options.port
  }

  get connections(): number {
    return this.options.sockets.size
  }

  get status(): LocalTransportStatus {
    return { active: this.running, connections: this.connections }
  }

  async start(): Promise<void> {
    if (this.running) return

    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
    // The WebSocket bridge authenticates with E2EE and marks its own requests.
    // Strip that marker from local HTTP so a loopback client cannot skip the
    // bearer token by forging the header.
    const listener = getRequestListener(async (request) => {
      const headers = new Headers(request.headers)
      headers.delete('x-clara-agent')
      return this.options.api.fetch(new Request(request, { headers }))
    })
    // Cookies are host-scoped, so unrelated apps on 127.0.0.1 can share a jar
    // larger than Node's 16k default with the WebSocket handshake.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, listener)

    server.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/ws') {
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (client) => {
        this.options.sockets.add(client)
        this.options.log?.('local client connected')
        const sids = new Set<string>()
        let dropped = false
        const drop = () => {
          if (dropped) return
          dropped = true
          this.options.sockets.delete(client)
          for (const sid of sids) this.options.agent.disconnect(sid)
          sids.clear()
          this.options.log?.('local client disconnected')
        }
        client.on('message', (data) => {
          const text = data.toString()
          this.options.agent.handleMessage(text)
          const sid = frameSid(text)
          if (sid) sids.add(sid)
        })
        client.on('close', drop)
        client.on('error', drop)
      })
    })

    try {
      const listen = (port: number) =>
        new Promise<void>((resolve, reject) => {
          const onError = (cause: Error & { code?: string }) => {
            server.off('listening', onListening)
            reject(cause)
          }
          const onListening = () => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, this.options.host)
        })

      try {
        await listen(this.options.port)
      } catch (cause) {
        // A preferred port may belong to another process. The desktop and CLI
        // hide that detail: bind an ephemeral port and publish it instead.
        if (
          this.options.port !== 0 &&
          cause instanceof Error &&
          (cause as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ) {
          this.options.log?.(`local port ${this.options.port} is busy; choosing an ephemeral port`)
          await listen(0)
        } else {
          throw cause
        }
      }

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('The local transport did not report a TCP address')
      }
      this.boundPort = address.port
      this.options.port = address.port
      this.options.onBound?.(address.port)
    } catch (cause) {
      wss.close()
      server.close()
      throw cause
    }

    this.server = server
    this.wss = wss
    this.running = true
  }

  async stop(reason = 'local transport disabled'): Promise<void> {
    const server = this.server
    const wss = this.wss
    this.server = undefined
    this.wss = undefined
    this.running = false
    if (!server || !wss) return

    await Promise.all(
      [...this.options.sockets].map(
        (client) =>
          new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer)
              resolve()
            }
            const timer = setTimeout(() => {
              client.terminate()
              finish()
            }, CLOSE_GRACE_MS)
            timer.unref()
            client.once('close', finish)
            try {
              client.close(1001, reason)
            } catch {
              client.terminate()
              finish()
            }
          })
      )
    )
    this.options.sockets.clear()

    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }
}

function frameSid(text: string): string | undefined {
  try {
    return parseWireFrame(JSON.parse(text))?.sid
  } catch {
    return undefined
  }
}

export function broadcast(sockets: Set<WebSocket>, frame: WireFrame): void {
  if (sockets.size === 0) return
  const data = JSON.stringify(frame)
  for (const client of sockets) {
    if (client.readyState !== WebSocket.OPEN) continue
    try {
      client.send(data)
    } catch {
      sockets.delete(client)
    }
  }
}
