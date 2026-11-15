import { createServer, type Server } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { parseWireFrame, type WireFrame } from '@clara/shared-types'
import type { Agent } from './agent.ts'
import type { ApiApp } from './api/context.ts'

export type LocalTransportOptions = {
  host: string
  /** Extra addresses to bind on the same port. Loopback is always primary. */
  hosts?: string[]
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
 * The local WebSocket listener owns one HTTP server per bound address and one
 * shared WebSocketServer. It can be stopped and started again without
 * recreating the Agent or its socket set, which keeps the transport switch
 * independent of E2EE sessions.
 *
 * Binding is by address, not by "all interfaces or loopback only": a hub can
 * expose itself to local Docker containers or the LAN without changing the
 * address a local desktop already uses.
 */
export class LocalTransport {
  private readonly options: LocalTransportOptions
  private listeners: { host: string; server: Server }[] = []
  private wss: WebSocketServer | undefined
  private running = false
  private boundPort: number | undefined
  private boundHosts: string[] = []

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

  /** Every address the listener actually bound. */
  get hosts(): string[] {
    return [...this.boundHosts]
  }

  get connections(): number {
    return this.options.sockets.size
  }

  get status(): LocalTransportStatus {
    return { active: this.running, connections: this.connections }
  }

  /** Replace the bind addresses. Stop and start the transport to apply them. */
  setHosts(hosts: readonly string[]): void {
    this.options.hosts = normalizeHosts(hosts)
    this.options.host = this.options.hosts[0] ?? this.options.host
  }

  async start(): Promise<void> {
    if (this.running) return

    const hosts = normalizeHosts(
      this.options.hosts?.length ? this.options.hosts : [this.options.host]
    )
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
    // The WebSocket bridge authenticates with E2EE and marks its own requests.
    // Strip that marker from local HTTP so a loopback client cannot skip the
    // bearer token by forging the header.
    const listener = getRequestListener(async (request) => {
      const headers = new Headers(request.headers)
      headers.delete('x-clara-agent')
      return this.options.api.fetch(new Request(request, { headers }))
    })

    const servers = hosts.map((host) => {
      // Cookies are host-scoped, so unrelated apps on 127.0.0.1 can share a jar
      // larger than Node's 16k default with the WebSocket handshake.
      const server = createServer({ maxHeaderSize: 64 * 1024 }, listener)
      this.attachUpgrade(server, wss)
      return { host, server }
    })
    const primary = servers[0]

    try {
      let port = this.options.port
      try {
        await listen(primary.server, port, primary.host)
      } catch (cause) {
        // A preferred port may belong to another process. The desktop and CLI
        // hide that detail: bind an ephemeral port and publish it instead.
        if (
          port !== 0 &&
          cause instanceof Error &&
          (cause as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ) {
          this.options.log?.(`local port ${port} is busy; choosing an ephemeral port`)
          port = 0
          await listen(primary.server, 0, primary.host)
        } else {
          throw cause
        }
      }

      const address = primary.server.address()
      if (!address || typeof address === 'string') {
        throw new Error('The local transport did not report a TCP address')
      }
      const boundPort = address.port

      const bound: { host: string; server: Server }[] = [primary]
      for (const entry of servers.slice(1)) {
        try {
          await listen(entry.server, boundPort, entry.host)
          bound.push(entry)
        } catch (cause) {
          // An extra address can disappear (a Docker bridge stops, a laptop
          // leaves the network). Keep the rest of the listeners alive.
          this.options.log?.(
            `could not bind the local WebSocket on ${entry.host}; continuing without it`,
            cause
          )
        }
      }

      this.listeners = bound
      this.boundHosts = bound.map((entry) => entry.host)
      this.boundPort = boundPort
      this.options.port = boundPort
      this.options.host = primary.host
      this.options.onBound?.(boundPort)
    } catch (cause) {
      wss.close()
      await Promise.allSettled(servers.map((entry) => closeServer(entry.server)))
      throw cause
    }

    this.wss = wss
    this.running = true
  }

  async stop(reason = 'local transport disabled'): Promise<void> {
    const listeners = this.listeners
    const wss = this.wss
    this.listeners = []
    this.boundHosts = []
    this.wss = undefined
    this.running = false
    if (listeners.length === 0 || !wss) return

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
    await Promise.all(listeners.map((entry) => closeServer(entry.server)))
  }

  private attachUpgrade(server: Server, wss: WebSocketServer): void {
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
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
    server.listen(port, host)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function normalizeHosts(hosts: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of hosts) {
    const host = value.trim().replace(/^\[(.*)\]$/, '$1')
    if (!host || seen.has(host)) continue
    seen.add(host)
    next.push(host)
  }
  if (next.includes('0.0.0.0')) return ['0.0.0.0']
  if (next.includes('::')) return ['::']
  return next.length > 0 ? next : ['127.0.0.1']
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
