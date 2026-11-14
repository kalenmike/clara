import { WebSocket } from 'ws'
import type { AdapterIdentity } from './types.ts'
import { REINSTALL_GRANT_MESSAGE } from './config.ts'
import {
  ReplayGuard,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveSessionKeys,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  isErrorFrame,
  isHelloFrame,
  isSealedFrame,
  type AdapterAction,
  type AdapterRequestAction,
  type AdapterResponseState,
  type ClaraAction,
  type ClaraState,
  type RelayGrantState,
  type WireFrame,
} from '@clara/shared-types'

const RECONNECT_MAX_MS = 30_000
const HEARTBEAT_MS = 20_000
const STALL_MS = 45_000
const HANDSHAKE_TIMEOUT_MS = 10_000

export type AdapterTransportInfo = {
  adapterVersion: string
  protocolVersion: number
  harnessVersion?: string
  capabilities: Record<string, unknown>
}

export type AdapterTransportStatus = {
  status: 'connecting' | 'connected' | 'authenticated' | 'offline' | 'stopped'
  connected: boolean
  authenticated: boolean
  lastFrameAt?: number
  lastError?: string
}

export type AdapterTransportOptions = {
  wsUrl: string
  /** Relay grant from the config. Absent in local mode. */
  grant?: string
  identity: AdapterIdentity
  kind: string
  label: string
  info: AdapterTransportInfo
  handler: (request: Request) => Promise<Response>
  /** Persist a refreshed grant after an authenticated `ready`. */
  onRelayGrant?: (grant: RelayGrantState) => void
  log?: (message: string, detail?: unknown) => void
}

type Pending = {
  controller: ReadableStreamDefaultController<Uint8Array>
  stream: ReadableStream<Uint8Array>
  resolve: (response: Response) => void
  reject: (cause: unknown) => void
  started: boolean
}

export class AdapterTransport {
  private readonly options: AdapterTransportOptions
  private socket: WebSocket | null = null
  private keys: SessionKeys | null = null
  private sid = ''
  private sendSeq = 0
  private sendChain: Promise<void> = Promise.resolve()
  private receive = new ReplayGuard()
  private pending = new Map<string, Pending>()
  /** In-flight requests the hub sent to this adapter, keyed by request id. */
  private readonly inbound = new Map<string, AbortController>()
  private stopped = true
  private retry = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private handshakeTimer: NodeJS.Timeout | null = null
  private lastSeen = 0
  /** Last frame that belonged to this session, not another broadcast session. */
  private lastHubFrameAt = 0
  private connected = false
  private authenticated = false
  private lastError: string | undefined
  private messageChain: Promise<void> = Promise.resolve()
  /** Relay grant in memory; refreshed by `ready` and persisted by the CLI. */
  private grant: string

  constructor(options: AdapterTransportOptions) {
    this.options = options
    this.grant = options.grant ?? ''
  }

  get online(): boolean {
    return this.connected
  }

  get status(): AdapterTransportStatus {
    const status: AdapterTransportStatus['status'] = this.stopped
      ? 'stopped'
      : this.authenticated
        ? 'authenticated'
        : this.connected
          ? 'connected'
          : this.socket
            ? 'connecting'
            : 'offline'
    return {
      status,
      connected: this.connected,
      authenticated: this.authenticated,
      ...(this.lastHubFrameAt > 0 ? { lastFrameAt: this.lastHubFrameAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.handshakeTimer = null
    this.socket?.close(1000, 'adapter shutting down')
    this.socket = null
    this.keys = null
    this.sendChain = Promise.resolve()
    this.connected = false
    this.authenticated = false
    this.lastHubFrameAt = 0
    this.abortInbound()
    this.rejectAll(new Error('Adapter connection closed'))
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.keys) {
      throw new Error('The harness adapter is offline')
    }
    const url = new URL(request.url)
    const id = bytesToBase64Url(randomBytes(12))
    const body = request.body ? await request.text() : undefined
    const action: AdapterRequestAction = {
      type: 'adapter.request',
      id,
      method: request.method as AdapterRequestAction['method'],
      path: url.pathname,
      ...(url.search ? { search: url.search } : {}),
      headers: Object.fromEntries(request.headers.entries()),
      ...(body === undefined ? {} : { body }),
    }

    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    })
    const response = new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { controller, stream, resolve, reject, started: false })
    })
    try {
      await this.send(action)
    } catch (cause) {
      this.pending.delete(id)
      try {
        controller.error(cause)
      } catch {
        // The stream may already be closed.
      }
      throw cause
    }
    return response
  }

  private connect(): void {
    if (this.stopped) return
    this.authenticated = false
    const protocols = this.subprotocols()
    const socket = new WebSocket(this.options.wsUrl, protocols)
    this.socket = socket

    socket.on('unexpected-response', (request, response) => {
      response.resume()
      if (this.socket !== socket) {
        request.destroy()
        return
      }
      if (response.statusCode === 401) {
        // The relay verifies the grant before the upgrade. A 401 means this
        // grant is expired or unknown, which only a new pairing code fixes.
        this.stopForGrant()
        request.destroy()
        return
      }
      this.lastError = `The relay refused the connection (${response.statusCode})`
      this.options.log?.(this.lastError)
      request.destroy()
      // A proxy or a relay restart can answer without upgrading; retry with
      // backoff instead of leaving the adapter stuck without a socket.
      this.socket = null
      this.scheduleReconnect()
    })

    socket.on('open', () => {
      if (this.socket !== socket) return
      this.retry = 0
      this.lastSeen = Date.now()
      this.lastHubFrameAt = Date.now()
      this.lastError = undefined
      this.sendChain = Promise.resolve()
      this.startHeartbeat(socket)
      this.startHandshakeTimer(socket)
      void this.handshake(socket)
    })

    socket.on('pong', () => {
      this.lastSeen = Date.now()
    })

    socket.on('message', (data) => {
      this.lastSeen = Date.now()
      const text = data.toString()
      this.messageChain = this.messageChain
        .then(() => this.handleMessage(text))
        .catch((cause) => this.options.log?.('adapter frame error', cause))
    })

    socket.on('error', (cause) => {
      if (this.socket !== socket) return
      this.lastError = cause instanceof Error ? cause.message : String(cause)
      this.options.log?.('adapter socket error', cause)
    })
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return
      if (!this.stopped) {
        this.lastError = `Disconnected (${code} ${reason.toString() || 'no reason'})`
      }
      this.socket = null
      this.keys = null
      this.connected = false
      this.authenticated = false
      this.lastHubFrameAt = 0
      this.sendChain = Promise.resolve()
      this.stopHeartbeat()
      this.stopHandshakeTimer()
      this.abortInbound()
      this.rejectAll(
        new Error(`Adapter disconnected (${code} ${reason.toString() || 'no reason'})`)
      )
      this.scheduleReconnect()
    })
  }

  /**
   * Relay subprotocols carry the grant. Local mode has no grant and keeps the
   * bare socket, which is what the hub's local listener expects.
   */
  private subprotocols(): string[] | undefined {
    if (!this.grant) return undefined
    return [RELAY_SUBPROTOCOL, `${RELAY_ROLE_PREFIX}client`, `${RELAY_AUTH_PREFIX}${this.grant}`]
  }

  private async handshake(socket: WebSocket): Promise<void> {
    this.sid = bytesToBase64Url(randomBytes(16))
    const clientNonce = bytesToBase64Url(randomBytes(16))
    this.handshakeNonce = clientNonce
    socket.send(
      JSON.stringify({
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid: this.sid,
        nonce: clientNonce,
        role: 'client',
        adapter: true,
        adapterId: this.options.identity.adapterId,
      })
    )
  }

  private handshakeNonce = ''

  private async handleMessage(text: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }

    if (isHelloFrame(parsed)) {
      if (parsed.sid !== this.sid || parsed.role !== 'agent') return
      const keys = await deriveSessionKeys({
        key: this.options.identity.key,
        sid: this.sid,
        clientNonce: this.handshakeNonce,
        agentNonce: parsed.nonce,
      })
      this.keys = keys
      this.receive = new ReplayGuard()
      this.sendSeq = 0
      this.sendChain = Promise.resolve()
      this.connected = true
      this.lastHubFrameAt = Date.now()
      this.lastError = undefined
      this.options.log?.('adapter handshake complete')
      return
    }

    if (isErrorFrame(parsed)) {
      // Error frames are broadcast to every socket, so ignore another session's.
      if (parsed.sid !== this.sid) return
      this.lastError = `${parsed.code}: ${parsed.message}`
      this.options.log?.(`adapter session error: ${parsed.code} ${parsed.message}`)
      this.socket?.close(1000, parsed.code)
      return
    }

    // Sealed frames are broadcast too. Trying to open a frame for another
    // session fails the replay/decrypt step and would tear down this adapter.
    if (!isSealedFrame(parsed) || parsed.sid !== this.sid || !this.keys) return
    this.lastHubFrameAt = Date.now()
    try {
      this.receive.check(parsed.seq)
      const plaintext = await open(
        this.keys.s2c,
        { sid: parsed.sid, direction: 's2c', seq: parsed.seq },
        { iv: parsed.iv, ct: parsed.ct }
      )
      const payload = JSON.parse(new TextDecoder().decode(plaintext)) as
        ClaraAction | ClaraState | AdapterAction | AdapterResponseState
      await this.handlePayload(payload)
      if (!this.authenticated) {
        this.authenticated = true
        this.lastError = undefined
        this.stopHandshakeTimer()
        this.options.log?.('adapter authenticated')
      }
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause)
      this.options.log?.('adapter could not open a frame', cause)
      this.socket?.close(1000, 'bad frame')
    }
  }

  private async handlePayload(
    payload: ClaraAction | ClaraState | AdapterAction | AdapterResponseState
  ): Promise<void> {
    switch (payload.type) {
      case 'adapter.request':
        void this.runRequest(payload)
        return
      case 'adapter.abort': {
        const pending = this.pending.get(payload.id)
        if (pending) pending.controller.error(new Error('Request aborted'))
        this.pending.delete(payload.id)
        this.inbound.get(payload.id)?.abort()
        return
      }
      case 'adapter.response':
      case 'adapter.chunk':
      case 'adapter.end':
      case 'adapter.error':
        this.handleResponse(payload)
        return
      case 'ping':
        await this.send({ type: 'pong', at: payload.at })
        return
      case 'ready': {
        // The hub refreshes the adapter grant on every accepted connect. Keep
        // the new one in memory for reconnects and persist it for restarts.
        if (payload.relayGrant) {
          this.grant = payload.relayGrant.grant
          try {
            this.options.onRelayGrant?.(payload.relayGrant)
          } catch (cause) {
            this.options.log?.('could not persist the refreshed relay grant', cause)
          }
        }
        await this.send({ type: 'ready.ack', agent: payload.agent })
        return
      }
      default:
        return
    }
  }

  private async runRequest(action: AdapterRequestAction): Promise<void> {
    const controller = new AbortController()
    this.inbound.set(action.id, controller)
    try {
      const url = new URL(`http://adapter${action.path}${action.search ?? ''}`)
      const headers = new Headers(action.headers)
      const response = await this.options.handler(
        new Request(url, {
          method: action.method,
          headers,
          ...(action.body === undefined ? {} : { body: action.body }),
          signal: controller.signal,
        })
      )
      if (controller.signal.aborted) return
      await this.send({
        type: 'adapter.response',
        id: action.id,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      })
      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              await this.send({
                type: 'adapter.chunk',
                id: action.id,
                data: bytesToBase64Url(value),
              })
            }
          }
        } finally {
          reader.releaseLock()
        }
      }
      if (!controller.signal.aborted) {
        await this.send({ type: 'adapter.end', id: action.id })
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        await this.send({
          type: 'adapter.error',
          id: action.id,
          code: 'adapter_error',
          message: cause instanceof Error ? cause.message : String(cause),
        }).catch(() => {})
      }
    } finally {
      this.inbound.delete(action.id)
    }
  }

  private handleResponse(payload: AdapterResponseState): void {
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

  private send(payload: unknown): Promise<void> {
    const socket = this.socket
    const sid = this.sid
    const run = this.sendChain.then(async () => {
      // A frame queued for an old connection must not consume a sequence number
      // in the session that replaced it.
      if (this.socket !== socket || this.sid !== sid) return
      const keys = this.keys
      if (!socket || socket.readyState !== WebSocket.OPEN || !keys) {
        throw new Error('The harness adapter is offline')
      }
      const seq = this.sendSeq
      this.sendSeq += 1
      const box = await seal(
        keys.c2s,
        { sid, direction: 'c2s', seq },
        utf8(JSON.stringify(payload))
      )
      if (this.socket !== socket || this.sid !== sid) return
      const frame: WireFrame = {
        t: 'sealed',
        v: PROTOCOL_VERSION,
        sid,
        seq,
        iv: box.iv,
        ct: box.ct,
      }
      socket.send(JSON.stringify(frame))
    })
    this.sendChain = run.catch(() => {})
    return run
  }

  private abortInbound(): void {
    for (const controller of this.inbound.values()) controller.abort()
    this.inbound.clear()
  }

  private rejectAll(cause: unknown): void {
    for (const pending of this.pending.values()) {
      try {
        if (pending.started) pending.controller.error(cause)
        else pending.reject(cause)
      } catch {
        // The stream may already be closed.
      }
    }
    this.pending.clear()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const base = Math.min(1_000 * 2 ** Math.min(this.retry, 5), RECONNECT_MAX_MS)
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.retry += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
    this.reconnectTimer.unref()
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastSeen > STALL_MS) {
        socket.terminate()
        return
      }
      // The hub broadcasts frames for every session, so socket-level traffic is
      // not proof that this adapter's session is still registered. Require a
      // frame or pong for this session and reconnect when it goes quiet.
      if (this.authenticated && Date.now() - this.lastHubFrameAt > STALL_MS) {
        this.lastError = 'The hub stopped answering this adapter session'
        this.options.log?.('adapter heartbeat timed out')
        socket.terminate()
        return
      }
      if (this.authenticated) {
        void this.send({ type: 'ping', at: Date.now() }).catch(() => {})
      }
      socket.ping()
    }, HEARTBEAT_MS)
    this.heartbeatTimer.unref()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private startHandshakeTimer(socket: WebSocket): void {
    this.stopHandshakeTimer()
    this.handshakeTimer = setTimeout(() => {
      if (this.socket !== socket || this.authenticated) return
      this.lastError = 'The hub did not finish the E2EE handshake'
      this.options.log?.('adapter handshake timed out')
      socket.terminate()
    }, HANDSHAKE_TIMEOUT_MS)
    this.handshakeTimer.unref()
  }

  private stopHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
  }

  /**
   * The relay rejected the grant before the upgrade, so retrying with the same
   * config cannot succeed. Stop reconnecting and report the reinstall message.
   */
  private stopForGrant(): void {
    this.close()
    this.lastError = REINSTALL_GRANT_MESSAGE
    this.options.log?.(REINSTALL_GRANT_MESSAGE)
  }
}
