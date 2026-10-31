import { RELAY_SUBPROTOCOL } from '@clara/shared-types'
import type { Env } from './env.ts'

const MAX_BUFFERED_BYTES = 1_000_000
const REPLACED_CODE = 4002
const OFFLINE_CODE = 1013

/**
 * A room holds one home-agent socket and any number of client sockets. It does
 * not inspect or persist frames: client frames go to the agent, agent frames
 * are broadcast to every client. Session filtering happens in E2EE clients.
 */
export class RelayRoom {
  private readonly state: DurableObjectState

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }

    const role = request.headers.get('x-clara-role')
    if (role !== 'agent' && role !== 'client') {
      return new Response('Missing relay role', { status: 400 })
    }

    if (role === 'agent') {
      // A new home agent owns the room. Drop the old agent and make clients
      // re-handshake immediately against the new process.
      for (const socket of this.state.getWebSockets('agent')) {
        socket.close(REPLACED_CODE, 'replaced by a new agent')
      }
      this.closeClients(1012, 'home server reconnected')
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server, [role])

    return new Response(null, {
      status: 101,
      headers: { 'Sec-WebSocket-Protocol': RELAY_SUBPROTOCOL },
      webSocket: client,
    })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const tags = this.state.getTags(socket)
    const role = tags.includes('agent') ? 'agent' : tags.includes('client') ? 'client' : null
    if (!role) return

    if (role === 'agent') {
      for (const client of this.state.getWebSockets('client')) {
        this.send(client, message)
      }
      return
    }

    const agents = this.state.getWebSockets('agent')
    if (agents.length === 0) {
      socket.close(OFFLINE_CODE, 'home server offline')
      return
    }
    for (const agent of agents) this.send(agent, message)
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const tags = this.state.getTags(socket)
    if (!tags.includes('agent')) return
    // 4002 means a replacement connection already took over; its fetch handler
    // has already closed the clients.
    if (code === REPLACED_CODE) return
    this.closeClients(1012, reason || 'home server disconnected')
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    const tags = this.state.getTags(socket)
    socket.close(1011, 'relay error')
    if (tags.includes('agent')) this.closeClients(1012, 'home server error')
  }

  private send(socket: WebSocket, message: string | ArrayBuffer): void {
    if (socket.readyState !== 1) return
    const buffered = (socket as WebSocket & { bufferedAmount?: number }).bufferedAmount ?? 0
    if (buffered > MAX_BUFFERED_BYTES) {
      socket.close(OFFLINE_CODE, 'slow consumer')
      return
    }
    try {
      socket.send(message)
    } catch {
      socket.close(1011, 'send failed')
    }
  }

  private closeClients(code: number, reason: string): void {
    for (const client of this.state.getWebSockets('client')) {
      try {
        client.close(code, reason)
      } catch {
        // already closing
      }
    }
  }
}
