import {
  PROTOCOL_VERSION,
  RELAY_GRANT_MAX_ID_LENGTH,
  RELAY_SUBPROTOCOL,
  RELAY_WIRE_VERSION,
  type RouteFrameV3,
} from '@clara/shared-types'
import type { Env } from './env.ts'

const MAX_BUFFERED_BYTES = 1_000_000
const MAX_CLIENT_FRAME_BYTES = 128 * 1024

/**
 * A room holds up to 32 clients. A browser plus a few adapters and phones is
 * well under this; the cap only stops one token holder from filling the room.
 * It is intentionally higher than the per-IP cap so a second network can join.
 */
export const MAX_CLIENT_SOCKETS_PER_ROOM = 32

/**
 * Eight concurrent sockets from one address. A phone, desktop, PWA, and an
 * adapter on the same NAT stay connected, while a reconnect storm cannot
 * consume the whole room from a single host.
 */
export const MAX_CLIENT_SOCKETS_PER_IP = 8

/**
 * Sustained per-peer frame budget with a one-second burst. The byte budget
 * already limits a 32 KiB adapter stream to sixteen chunks per second, so 60
 * frames/s comfortably covers browsers and adapters while still catching a
 * flood; a higher ceiling would let a stolen token sustain more work unnoticed.
 */
const CLIENT_FRAMES_PER_SECOND = 60
export const CLIENT_FRAME_BURST = CLIENT_FRAMES_PER_SECOND
/**
 * Sustained per-peer byte budget with a two-second burst. 512 KiB/s matches
 * sixteen 32 KiB adapter chunks per second and 1 MiB absorbs a short upload
 * without throttling ordinary traffic.
 */
const CLIENT_BYTES_PER_SECOND = 512 * 1024
const CLIENT_BYTE_BURST = CLIENT_BYTES_PER_SECOND * 2

const REPLACED_CODE = 4002
/** Client limit refusals share one code; the close reason names the limit. */
const CLIENT_LIMIT_CODE = 4008
const FRAME_TOO_LARGE_CODE = 4009
const OFFLINE_CODE = 1013

/**
 * The route envelope this room speaks; the hub refuses anything older. It is
 * the shared constant so the Worker, the hub's relay client, and the panel
 * deploy check cannot drift apart.
 */
export const RELAY_VERSION = RELAY_WIRE_VERSION

type Attachment = {
  peer?: string
  ip?: string
  /** Grant id the Worker verified before the upgrade; tags every frame. */
  grant?: string
}

type TokenBucket = { tokens: number; at: number }

type PeerLimits = { frames: TokenBucket; bytes: TokenBucket }

/**
 * A room holds one hub socket and any number of client sockets. It does not
 * inspect or persist frame contents: client frames are tagged with the
 * relay-assigned peer id and forwarded to the hub, hub frames are broadcast to
 * every client. Session filtering happens in E2EE clients; binding a session
 * to a peer happens in the hub.
 *
 * Per-peer rate state and connection counts live in memory only. Hibernation
 * resets them, which is acceptable: the peer id and IP stay in the socket
 * attachment so a resumed socket keeps working, and a resumed flooder simply
 * starts with a fresh bucket.
 */
export class RelayRoom {
  private readonly state: DurableObjectState
  private readonly peers = new Map<string, PeerLimits>()
  /**
   * A refused socket must never forward another frame. Closing is asynchronous,
   * so frames already queued behind the refused one can still reach the room;
   * forwarding one of those would leave a hole in the client's sealed sequence.
   */
  private readonly refused = new WeakSet<WebSocket>()

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  /** Live per-peer limit state; used by tests to prove cleanup on close. */
  get peerStateCount(): number {
    return this.peers.size
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }

    const role = request.headers.get('x-clara-role')
    if (role !== 'agent' && role !== 'client') {
      return new Response('Missing relay role', { status: 400 })
    }

    // The Worker stamps this after verifying the grant. Without it the hub
    // cannot bind the session identity, so refuse instead of guessing.
    const clientGrant =
      role === 'client' ? normalizeGrantId(request.headers.get('x-clara-grant-id')) : undefined
    if (role === 'client' && !clientGrant) {
      return new Response('Missing relay grant id', { status: 400 })
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

    if (role === 'client') {
      // Accept first, then close, so the refused client still receives the
      // application close code instead of a failed upgrade.
      const reason = this.clientLimitReason(request.headers.get('cf-connecting-ip'))
      if (reason) {
        server.close(CLIENT_LIMIT_CODE, reason)
      } else {
        // The peer id and grant id are both per-connection, so they must
        // survive hibernation in the attachment. Only clients carry them.
        const ip = normalizeIp(request.headers.get('cf-connecting-ip'))
        const attachment: Attachment = { peer: randomPeerId() }
        if (clientGrant) attachment.grant = clientGrant
        if (ip) attachment.ip = ip
        server.serializeAttachment(attachment)
      }
    }

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
    if (this.refused.has(socket)) return

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
      this.refuse(socket, FRAME_TOO_LARGE_CODE, 'frame too large')
      return
    }

    const peer = this.peerOf(socket)
    const grantId = peerAttachment(socket)?.grant
    if (typeof grantId !== 'string' || grantId.length === 0) {
      // Without the verified grant id the hub could not bind the identity, so
      // drop the peer rather than forward an unattributable frame.
      socket.close(CLIENT_LIMIT_CODE, 'missing grant')
      return
    }
    // The grant id is the identity budget: a reconnecting device shares one
    // bucket instead of resetting its budget on every socket.
    if (!this.withinRate(grantId, size)) {
      this.refuse(socket, CLIENT_LIMIT_CODE, 'rate limit')
      return
    }

    const agents = this.state.getWebSockets('agent')
    if (agents.length === 0) {
      socket.close(OFFLINE_CODE, 'hub offline')
      return
    }

    const route = this.route(peer, grantId, message)
    for (const agent of agents) this.send(agent, route)
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const tags = this.state.getTags(socket)
    if (!tags.includes('agent')) {
      // Drop the rate bucket so peer churn cannot grow the map.
      this.forgetPeer(socket)
      return
    }
    // 4002 means a replacement connection already took over; its fetch handler
    // has already closed the clients.
    if (code === REPLACED_CODE) return
    this.closeClients(1012, reason || 'hub disconnected')
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    const tags = this.state.getTags(socket)
    this.forgetPeer(socket)
    socket.close(1011, 'relay error')
    if (tags.includes('agent')) this.closeClients(1012, 'hub error')
  }

  /**
   * Return a close reason when this client cannot join, or nothing when it can.
   * The socket being admitted is already accepted but has no attachment, so it
   * is not counted as an existing client.
   */
  private clientLimitReason(header: string | null): string | undefined {
    const clients = this.acceptedClients()
    if (clients.length >= MAX_CLIENT_SOCKETS_PER_ROOM) return 'room full'

    const ip = normalizeIp(header)
    if (!ip) return undefined
    let fromIp = 0
    for (const socket of clients) {
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment?.ip === ip) fromIp += 1
    }
    return fromIp >= MAX_CLIENT_SOCKETS_PER_IP ? 'too many connections' : undefined
  }

  private acceptedClients(): WebSocket[] {
    return this.state
      .getWebSockets('client')
      .filter((socket) => typeof peerAttachment(socket)?.peer === 'string')
  }

  /** Refill both buckets for the elapsed time, then charge the frame once. */
  private withinRate(identity: string, size: number): boolean {
    const now = Date.now()
    let limits = this.peers.get(identity)
    if (!limits) {
      limits = {
        frames: { tokens: CLIENT_FRAME_BURST, at: now },
        bytes: { tokens: CLIENT_BYTE_BURST, at: now },
      }
      this.peers.set(identity, limits)
    }

    const frames = refill(limits.frames, CLIENT_FRAME_BURST, CLIENT_FRAMES_PER_SECOND, now)
    const bytes = refill(limits.bytes, CLIENT_BYTE_BURST, CLIENT_BYTES_PER_SECOND, now)
    if (frames < 1 || bytes < size) return false

    limits.frames.tokens -= 1
    limits.bytes.tokens -= size
    return true
  }

  /**
   * Stop forwarding this socket and close it. The marker is checked before the
   * rate budget, so frames already queued behind the refusal cannot slip past
   * a refreshed bucket and leave a hole in the client's sealed sequence.
   */
  private refuse(socket: WebSocket, code: number, reason: string): void {
    this.refused.add(socket)
    socket.close(code, reason)
  }

  /**
   * Drop the grant budget only when the last socket using it is gone. Two tabs
   * share one grant, so closing one must not reset the other's budget.
   */
  private forgetPeer(socket: WebSocket): void {
    const grant = peerAttachment(socket)?.grant
    if (typeof grant !== 'string') return
    for (const other of this.state.getWebSockets('client')) {
      if (other !== socket && peerAttachment(other)?.grant === grant) return
    }
    this.peers.delete(grant)
  }

  /** Hibernation drops in-memory state; the attachment is the source of truth. */
  private peerOf(socket: WebSocket): string {
    const peer = peerAttachment(socket)?.peer
    if (typeof peer === 'string' && peer.length > 0) return peer
    const next = randomPeerId()
    const existing = peerAttachment(socket) ?? {}
    socket.serializeAttachment({ ...existing, peer: next } satisfies Attachment)
    return next
  }

  private route(peer: string, grantId: string, message: string | ArrayBuffer): string {
    const frame: RouteFrameV3 =
      typeof message === 'string'
        ? { t: 'route', v: PROTOCOL_VERSION, p: peer, i: grantId, m: message }
        : {
            t: 'route',
            v: PROTOCOL_VERSION,
            p: peer,
            i: grantId,
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

function peerAttachment(socket: WebSocket): Attachment | null {
  return socket.deserializeAttachment() as Attachment | null
}

function normalizeIp(value: string | null): string | undefined {
  const ip = value?.trim()
  return ip ? ip : undefined
}

function normalizeGrantId(value: string | null): string | undefined {
  const grant = value?.trim()
  return grant && grant.length <= RELAY_GRANT_MAX_ID_LENGTH ? grant : undefined
}

/** Refill a bucket for the elapsed time, charge nothing, and return its tokens. */
function refill(bucket: TokenBucket, capacity: number, rate: number, now: number): number {
  const elapsed = Math.max(0, now - bucket.at)
  bucket.at = now
  bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed / 1000) * rate)
  return bucket.tokens
}

function randomPeerId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
