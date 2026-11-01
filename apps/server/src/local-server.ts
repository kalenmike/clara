import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { PROTOCOL_VERSION, type WireFrame } from '@clara/shared-types'
import type { Agent } from './agent.ts'
import { SERVER_VERSION } from './version.ts'

export type LocalTransportOptions = {
  host: string
  port: number
  agent: Agent
  /** Shared across restarts so outbound frames keep reaching new clients. */
  sockets: Set<WebSocket>
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

  constructor(options: LocalTransportOptions) {
    this.options = options
  }

  get active(): boolean {
    return this.running
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
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/health') {
        response.statusCode = 404
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'not found' }))
        return
      }

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(
        JSON.stringify({
          ok: true,
          version: SERVER_VERSION,
          protocol: PROTOCOL_VERSION,
          sessions: this.options.agent.sessionCount,
        })
      )
    })

    server.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/ws') {
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (client) => {
        this.options.sockets.add(client)
        this.options.log?.('local client connected')
        client.on('message', (data) => this.options.agent.handleMessage(data.toString()))
        client.on('close', () => {
          this.options.sockets.delete(client)
          this.options.log?.('local client disconnected')
        })
        client.on('error', () => {
          this.options.sockets.delete(client)
        })
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (cause: Error) => {
          server.off('listening', onListening)
          reject(cause)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(this.options.port, this.options.host)
      })
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
