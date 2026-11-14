import { PROTOCOL_VERSION, RELAY_SUBPROTOCOL, type RouteFrame } from '@clara/shared-types'
import type { Env } from './env.ts'

const MAX_BUFFERED_BYTES = 1_000_000
const MAX_CLIENT_FRAME_BYTES = 128 * 1024
const REPLACED_CODE = 4002
const FRAME_TOO_LARGE_CODE = 4009
const OFFLINE_CODE = 1013

/** The route envelope this room speaks; the hub refuses anything older. */
const RELAY_VERSION = 2

type Attachment = { peer?: unknown }

/**
 * A room holds one hub socket and any number of client sockets. It does not
 * inspect or persist frame contents: client frames are tagged with the
 * relay-assigned peer id and forwarded to the hub, hub frames are broadcast to
 * every client. Session filtering happens in E2EE clients; binding a session
 * to a peer happens in the hub.
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
      // A new hub owns the room. Drop the old hub and make clients
      // re-handshake immediately against the new process.
      for (const socket of this.state.getWebSockets('agent')) {
        socket.close(REPLACED_CODE, 'replaced by a new hub')
      }
      this.closeClients(1012, 'hub reconnected')
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server, [role])
    // The peer id is what the hub keys frames to, so it must survive
    // hibernation. Only client sockets carry one.
    if (role === 'client') server.serializeAttachment({ peer: randomPeerId() } satisfies Attachment)

    return new Response(null, {
      status: 101,
      headers: {
        'Sec-WebSocket-Protocol': RELAY_SUBPROTOCOL,
        'x-clara-relay-version': String(RELAY_VERSION),
      },
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

    const size =
      typeof message === 'string'
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength
    if (size > MAX_CLIENT_FRAME_BYTES) {
      socket.close(FRAME_TOO_LARGE_CODE, 'frame too large')
      return
    }

    const agents = this.state.getWebSockets('agent')
    if (agents.length === 0) {
      socket.close(OFFLINE_CODE, 'hub offline')
      return
    }

    const route = this.route(this.peerOf(socket), message)
    for (const agent of agents) this.send(agent, route)
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const tags = this.state.getTags(socket)
    if (!tags.includes('agent')) return
    // 4002 means a replacement connection already took over; its fetch handler
    // has already closed the clients.
    if (code === REPLACED_CODE) return
    this.closeClients(1012, reason || 'hub disconnected')
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    const tags = this.state.getTags(socket)
    socket.close(1011, 'relay error')
    if (tags.includes('agent')) this.closeClients(1012, 'hub error')
  }

  /** Hibernation drops in-memory state; the attachment is the source of truth. */
  private peerOf(socket: WebSocket): string {
    const attachment = socket.deserializeAttachment() as Attachment | null
    if (attachment && typeof attachment.peer === 'string' && attachment.peer.length > 0) {
      return attachment.peer
    }
    const peer = randomPeerId()
    socket.serializeAttachment({ peer } satisfies Attachment)
    return peer
  }

  private route(peer: string, message: string | ArrayBuffer): string {
    const frame: RouteFrame =
      typeof message === 'string'
        ? { t: 'route', v: PROTOCOL_VERSION, p: peer, m: message }
        : {
            t: 'route',
            v: PROTOCOL_VERSION,
            p: peer,
            b: true,
            m: toBase64Url(new Uint8Array(message)),
          }
    return JSON.stringify(frame)
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

function randomPeerId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
