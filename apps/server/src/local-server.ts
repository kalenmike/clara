import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { PROTOCOL_VERSION, type WireFrame } from '@clara/shared-types'
import type { Agent } from './agent.ts'
import { SERVER_VERSION } from './version.ts'

export type LocalServerOptions = {
  host: string
  port: number
  agent: Agent
  sockets: Set<WebSocket>
  log?: (message: string) => void
}

export type LocalServer = {
  server: Server
  close: () => Promise<void>
}

export async function startLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const { agent, sockets } = options
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
        sessions: agent.sessionCount,
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
      sockets.add(client)
      options.log?.('local client connected')
      client.on('message', (data) => agent.handleMessage(data.toString()))
      client.on('close', () => {
        sockets.delete(client)
        options.log?.('local client disconnected')
      })
      client.on('error', () => {
        sockets.delete(client)
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    server,
    close: async () => {
      for (const client of sockets) client.close(1001, 'server shutting down')
      sockets.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
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
