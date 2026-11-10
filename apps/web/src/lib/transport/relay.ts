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
  isHelloFrame,
  isSealedFrame,
  type AgentInfo,
  type ClaraAction,
  type ClaraState,
  type SyncCheckAction,
  type SyncErrorCode,
  type SyncPullAction,
  type SyncPushAction,
  type SyncSnapshot,
  type WireFrame,
} from '@clara/shared-types'
import { installPresenceTracking, readPresenceSnapshot } from '@/features/notifications/presence'

const HANDSHAKE_TIMEOUT_MS = 10_000
const REQUEST_HEAD_TIMEOUT_MS = 30_000
const HEARTBEAT_MS = 15_000
const STALL_MS = 45_000
const MAX_RECONNECT_MS = 15_000
const SYNC_TIMEOUT_MS = 30_000

/**
 * The agent accepts a bounded number of requests per session. Keep the web
 * below that ceiling so a feature burst (mailbox signals, project presence,
 * reconnect invalidations) queues instead of failing with too_many_requests.
 */
export const MAX_IN_FLIGHT_REQUESTS = 20

export type RelayTransportConfig = {
  wsUrl: string
  clientToken: string
  psk: string
  fingerprint: string
}

export type RelayTransportState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export type RelayTransportStatus = {
  state: RelayTransportState
  error: string | null
  agent: AgentInfo | null
}

export type PushStatusState = Extract<ClaraState, { type: 'push.status' }>

export type SyncRequestAction = SyncCheckAction | SyncPullAction | SyncPushAction

export type SyncResponse =
  | { type: 'revision'; namespace: string; revision: number }
  | { type: 'snapshot'; snapshot: SyncSnapshot }
  | {
      type: 'error'
      code: SyncErrorCode
      message: string
      snapshot?: SyncSnapshot
    }

export type RelayTransport = {
  fetch: typeof globalThis.fetch
  close: () => void
  subscribe: (listener: (status: RelayTransportStatus) => void) => () => void
  subscribePush: (listener: (state: PushStatusState) => void) => () => void
  addChannel: (channel: RelayChannel) => () => void
  requestSync: (action: SyncRequestAction) => Promise<SyncResponse>
  sendAction: (action: ClaraAction) => Promise<void>
  status: () => RelayTransportStatus
}

/** A feature-owned extension point for the relay transport. */
export type RelayChannel = {
  handlePayload?: (payload: ClaraAction | ClaraState) => boolean
  close?: (cause: unknown) => void
}

type PendingResponse = {
  id: string
  resolve: (response: Response) => void
  reject: (cause: unknown) => void
  controller: ReadableStreamDefaultController<Uint8Array> | null
  bodyless: boolean
  timer: number
  cleanup: () => void
  release: () => void
}

type QueuedRequest = {
  grant: () => void
  reject: (cause: unknown) => void
}

type PendingSync = {
  resolve: (response: SyncResponse) => void
  reject: (cause: unknown) => void
  timer: number
}

export function createRelayTransport(config: RelayTransportConfig): RelayTransport {
  return new RelayFetchTransport(config)
}

class RelayFetchTransport implements RelayTransport {
  readonly fetch: typeof globalThis.fetch

  private readonly config: RelayTransportConfig
  private readonly pending = new Map<string, PendingResponse>()
  private readonly syncPending = new Map<string, PendingSync>()
  private readonly listeners = new Set<(status: RelayTransportStatus) => void>()
  private readonly pushListeners = new Set<(state: PushStatusState) => void>()
  private readonly channels = new Set<RelayChannel>()
  private readonly queue: QueuedRequest[] = []
  private inFlight = 0
  private socket: WebSocket | null = null
  private keys: SessionKeys | null = null
  private sid: string | null = null
  private clientNonce: string | null = null
  private receive: ReplayGuard | null = null
  private sendChain: Promise<void> = Promise.resolve()
  private receiveChain: Promise<void> = Promise.resolve()
  private sendSeq = 0
  private statusValue: RelayTransportStatus = { state: 'idle', error: null, agent: null }
  private handshake: Promise<void> | null = null
  private handshakeResolve: (() => void) | null = null
  private handshakeReject: ((cause: unknown) => void) | null = null
  private handshakeTimer: number | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private stopPresenceTracking: (() => void) | null = null
  private lastReceivedAt = 0
  private retry = 0
  private closed = false

  constructor(config: RelayTransportConfig) {
    this.config = config
    this.fetch = this.doFetch.bind(this) as typeof globalThis.fetch
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearTimers()
    this.rejectHandshake(new Error('Relay transport closed'))
    this.failQueued(new Error('Relay transport closed'))
    this.failAll(new Error('Relay transport closed'))
    this.failAllSync(new Error('Relay transport closed'))

    for (const channel of this.channels) channel.close?.(new Error('Relay transport closed'))
    this.channels.clear()
    this.socket?.close(1000, 'client closed')
    this.socket = null
    this.setState('closed', null)
  }

  subscribe(listener: (status: RelayTransportStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.statusValue)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribePush(listener: (state: PushStatusState) => void): () => void {
    this.pushListeners.add(listener)
    return () => {
      this.pushListeners.delete(listener)
    }
  }

  addChannel(channel: RelayChannel): () => void {
    if (this.closed) {
      channel.close?.(new Error('Relay transport closed'))
      return () => {}
    }
    this.channels.add(channel)
    return () => {
      this.channels.delete(channel)
    }
  }

  async requestSync(action: SyncRequestAction): Promise<SyncResponse> {
    await this.ensureReady()
    if (this.closed) throw new Error('Relay transport closed')

    const response = new Promise<SyncResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.syncPending.delete(action.id)
        reject(new Error('Timed out waiting for the home server to sync settings'))
      }, SYNC_TIMEOUT_MS)
      this.syncPending.set(action.id, { resolve, reject, timer })
    })

    try {
      await this.send(action)
    } catch (cause) {
      this.failSyncPending(action.id, cause)
    }

    return response
  }

  sendAction(action: ClaraAction): Promise<void> {
    return this.send(action)
  }

  status(): RelayTransportStatus {
    return this.statusValue
  }

  private async doFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      throw new TypeError(`Relay transport cannot proxy ${url.pathname}`)
    }

    const signal = request.signal
    if (signal.aborted) throw abortError()

    await this.ensureReady()
    if (this.closed) throw new Error('Relay transport closed')

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer()

    const release = await this.acquire(signal)
    if (this.closed) {
      release()
      throw new Error('Relay transport closed')
    }

    const id = randomId()

    const response = new Promise<Response>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.failPending(id, new Error('Timed out waiting for the home server'))
        void this.send({ type: 'http.abort', id }).catch(() => {})
      }, REQUEST_HEAD_TIMEOUT_MS)

      const onAbort = () => {
        void this.send({ type: 'http.abort', id }).catch(() => {})
        this.failPending(id, abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })

      this.pending.set(id, {
        id,
        resolve,
        reject,
        controller: null,
        bodyless: false,
        timer,
        cleanup: () => signal.removeEventListener('abort', onAbort),
        release,
      })
    })

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    try {
      await this.send({
        type: 'http.request',
        id,
        method: request.method as HttpMethod,
        path: url.pathname,
        search: url.search,
        headers,
        body: body && body.byteLength > 0 ? bytesToBase64Url(new Uint8Array(body)) : undefined,
      })
    } catch (cause) {
      this.failPending(id, cause)
    }

    return response
  }

  private async ensureReady(): Promise<void> {
    if (this.closed) throw new Error('Relay transport closed')
    if (this.statusValue.state === 'open' && this.keys) return
    if (this.handshake) return this.handshake

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.handshake = new Promise<void>((resolve, reject) => {
      this.handshakeResolve = resolve
      this.handshakeReject = reject
    })
    this.openSocket()
    return this.handshake
  }

  private openSocket(): void {
    if (this.closed) return
    this.setState(this.retry === 0 ? 'connecting' : 'reconnecting', null)

    let socket: WebSocket
    try {
      socket = new WebSocket(this.config.wsUrl, [
        RELAY_SUBPROTOCOL,
        `${RELAY_ROLE_PREFIX}client`,
        `${RELAY_AUTH_PREFIX}${this.config.clientToken}`,
      ])
    } catch (cause) {
      this.rejectHandshake(cause)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.lastReceivedAt = Date.now()

    this.handshakeTimer = window.setTimeout(() => {
      this.rejectHandshake(new Error('The home server did not finish the E2EE handshake'))
      socket.close(4000, 'handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.sid = randomId()
      this.clientNonce = bytesToBase64Url(randomBytes(16))
      this.sendChain = Promise.resolve()
      this.receiveChain = Promise.resolve()
      this.sendSeq = 0
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid: this.sid,
          nonce: this.clientNonce,
          role: 'client',
        } satisfies WireFrame)
      )
    })

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      this.lastReceivedAt = Date.now()
      this.receiveChain = this.receiveChain.then(() => this.handleFrame(event.data)).catch(() => {})
    })

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return
      if (this.statusValue.state === 'open') {
        this.setState('open', 'The connection to the relay was interrupted')
        return
      }
      const reason = refusedReason(this.config.wsUrl)
      this.setState(this.statusValue.state, reason)
      // Browsers follow an error with a close, but not every runtime does, so
      // fail a pending handshake here as well.
      this.rejectHandshake(new Error(reason))
    })

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      const wasOpen = this.statusValue.state === 'open'
      this.socket = null
      this.keys = null
      this.receive = null
      this.stopHeartbeat()
      if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      const reason = describeClose(event, this.config.wsUrl, wasOpen)
      this.rejectHandshake(new Error(reason))
      this.failQueued(new Error(reason))
      this.failAll(new Error(reason))
      this.failAllSync(new Error(reason))

      if (this.closed) return
      this.setState('reconnecting', reason)
      this.scheduleReconnect()
    })
  }

  private async handleFrame(raw: unknown): Promise<void> {
    let text: string
    if (typeof raw === 'string') {
      text = raw
    } else if (raw instanceof ArrayBuffer) {
      text = new TextDecoder().decode(raw)
    } else if (ArrayBuffer.isView(raw)) {
      text = new TextDecoder().decode(raw)
    } else if (typeof Blob !== 'undefined' && raw instanceof Blob) {
      text = await raw.text()
    } else {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }

    if (isHelloFrame(parsed)) {
      if (parsed.role !== 'agent' || parsed.sid !== this.sid || !this.clientNonce) return
      try {
        const keys = await deriveSessionKeys({
          psk: this.config.psk,
          sid: parsed.sid,
          clientNonce: this.clientNonce,
          agentNonce: parsed.nonce,
        })
        if (keys.fingerprint !== this.config.fingerprint) {
          throw new Error('The pairing fingerprint does not match this server')
        }
        this.keys = keys
        this.receive = new ReplayGuard()
      } catch (cause) {
        this.rejectHandshake(cause)
        this.socket?.close(4001, 'fingerprint mismatch')
      }
      return
    }

    if (!isSealedFrame(parsed) || parsed.sid !== this.sid || !this.receive || !this.keys) return

    try {
      this.receive.check(parsed.seq)
    } catch (cause) {
      this.rejectHandshake(cause)
      this.socket?.close(4002, 'frame sequence error')
      return
    }

    let plaintext: Uint8Array<ArrayBuffer>
    try {
      plaintext = await open(
        this.keys.s2c,
        { sid: parsed.sid, direction: 's2c', seq: parsed.seq },
        parsed
      )
    } catch (cause) {
      this.rejectHandshake(cause)
      this.socket?.close(4003, 'decryption failed')
      return
    }

    let payload: ClaraAction | ClaraState
    try {
      payload = JSON.parse(new TextDecoder().decode(plaintext)) as ClaraAction | ClaraState
    } catch {
      return
    }

    if (payload.type === 'ready') {
      this.statusValue = { ...this.statusValue, agent: payload.agent }
      this.retry = 0
      this.setState('open', null)
      if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      void this.send({
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      }).catch(() => {})
      this.resolveHandshake()
      this.startHeartbeat()
      return
    }

    for (const channel of this.channels) {
      if (channel.handlePayload?.(payload)) return
    }

    if (payload.type === 'push.status') {
      this.emitPush(payload)
      return
    }

    if (isState(payload)) this.handleState(payload)
  }

  private handleState(state: Exclude<ClaraState, { type: 'push.status' }>): void {
    if (state.type === 'agent.status') {
      if (state.agent) {
        this.statusValue = { ...this.statusValue, agent: state.agent }
        this.emit()
      }
      return
    }

    if (
      state.type === 'sync.revision' ||
      state.type === 'sync.snapshot' ||
      state.type === 'sync.error'
    ) {
      this.handleSyncState(state)
      return
    }

    const pending = this.pending.get(state.id)
    if (!pending) return

    switch (state.type) {
      case 'http.response': {
        const headers = new Headers(state.headers)
        window.clearTimeout(pending.timer)
        if (state.status === 204 || state.status === 205 || state.status === 304) {
          pending.bodyless = true
          pending.resolve(
            new Response(null, { status: state.status, statusText: state.statusText, headers })
          )
          return
        }

        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            pending.controller = controller
          },
          cancel: () => {
            this.pending.delete(state.id)
            window.clearTimeout(pending.timer)
            pending.cleanup()
            pending.release()
            void this.send({ type: 'http.abort', id: state.id }).catch(() => {})
          },
        })
        pending.resolve(
          new Response(stream, {
            status: state.status,
            statusText: state.statusText,
            headers,
          })
        )
        return
      }
      case 'http.chunk': {
        if (!pending.controller) return
        pending.controller.enqueue(base64UrlToBytes(state.data))
        return
      }
      case 'http.end': {
        this.finishPending(state.id)
        return
      }
      case 'http.error': {
        const cause =
          state.code === 'aborted'
            ? abortError()
            : new Error(state.message || 'The home server request failed')
        if (pending.controller) {
          try {
            pending.controller.error(cause)
          } catch {
            // The stream was already closed.
          }
        } else {
          pending.reject(cause)
        }
        this.finishPending(state.id)
        return
      }
    }
  }

  private handleSyncState(
    state: Extract<ClaraState, { type: 'sync.revision' | 'sync.snapshot' | 'sync.error' }>
  ): void {
    const pending = this.syncPending.get(state.id)
    if (!pending) return
    this.syncPending.delete(state.id)
    window.clearTimeout(pending.timer)

    if (state.type === 'sync.revision') {
      pending.resolve({ type: 'revision', namespace: state.namespace, revision: state.revision })
      return
    }
    if (state.type === 'sync.snapshot') {
      pending.resolve({
        type: 'snapshot',
        snapshot: {
          namespace: state.namespace,
          revision: state.revision,
          entries: state.entries,
        },
      })
      return
    }

    pending.resolve({
      type: 'error',
      code: state.code,
      message: state.message,
      ...(state.revision !== undefined && state.entries !== undefined
        ? {
            snapshot: {
              namespace: state.namespace ?? 'default',
              revision: state.revision,
              entries: state.entries,
            },
          }
        : {}),
    })
  }

  private finishPending(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    window.clearTimeout(pending.timer)
    pending.cleanup()
    pending.release()
    if (pending.controller) {
      try {
        pending.controller.close()
      } catch {
        // already closed
      }
    }
  }

  private failPending(id: string, cause: unknown): void {
    const pending = this.pending.get(id)
    if (!pending) return
    try {
      pending.controller?.error(cause)
    } catch {
      // already closed
    }
    pending.reject(cause)
    this.pending.delete(id)
    window.clearTimeout(pending.timer)
    pending.cleanup()
    pending.release()
  }

  private failAll(cause: unknown): void {
    for (const id of [...this.pending.keys()]) this.failPending(id, cause)
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error('Relay transport closed'))
    if (signal.aborted) return Promise.reject(abortError())
    if (this.inFlight < MAX_IN_FLIGHT_REQUESTS) {
      this.inFlight += 1
      return Promise.resolve(() => this.releaseSlot())
    }

    return new Promise((resolve, reject) => {
      let entry: QueuedRequest
      const onAbort = () => {
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        reject(abortError())
      }
      entry = {
        grant: () => {
          signal.removeEventListener('abort', onAbort)
          this.inFlight += 1
          resolve(() => this.releaseSlot())
        },
        reject: (cause) => {
          signal.removeEventListener('abort', onAbort)
          reject(cause)
        },
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.queue.push(entry)
    })
  }

  private releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    this.queue.shift()?.grant()
  }

  private failQueued(cause: unknown): void {
    for (const entry of this.queue.splice(0)) entry.reject(cause)
  }

  private failSyncPending(id: string, cause: unknown): void {
    const pending = this.syncPending.get(id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    this.syncPending.delete(id)
    pending.reject(cause)
  }

  private failAllSync(cause: unknown): void {
    for (const id of [...this.syncPending.keys()]) this.failSyncPending(id, cause)
  }

  private send(payload: ClaraAction | ClaraState): Promise<void> {
    const run = this.sendChain.then(async () => {
      const socket = this.socket
      const keys = this.keys
      const sid = this.sid
      if (!socket || socket.readyState !== WebSocket.OPEN || !keys || !sid) {
        throw new Error('The relay is not connected')
      }
      const seq = this.sendSeq
      this.sendSeq += 1
      const box = await seal(
        keys.c2s,
        { sid, direction: 'c2s', seq },
        utf8(JSON.stringify(payload))
      )
      socket.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid,
          seq,
          iv: box.iv,
          ct: box.ct,
        } satisfies WireFrame)
      )
    })
    this.sendChain = run.catch(() => {})
    return run
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return
    const base = Math.min(1_000 * 2 ** Math.min(this.retry, 5), MAX_RECONNECT_MS)
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.retry += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.closed) return
      this.handshake = null
      void this.ensureReady().catch(() => {})
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.lastReceivedAt = Date.now()
    this.stopPresenceTracking = installPresenceTracking((reason) => {
      this.sendPresence(reason === 'pagehide')
    })
    this.sendPresence()
    this.heartbeatTimer = window.setInterval(() => {
      if (this.statusValue.state !== 'open') return
      if (Date.now() - this.lastReceivedAt > STALL_MS) {
        this.socket?.close(4004, 'heartbeat timeout')
        return
      }
      this.sendPresence()
    }, HEARTBEAT_MS)
  }

  private sendPresence(leaving = false): void {
    if (this.statusValue.state !== 'open') return
    void this.send({
      type: 'ping',
      at: Date.now(),
      presence: readPresenceSnapshot({ leaving }),
    }).catch(() => {})
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.stopPresenceTracking?.()
    this.stopPresenceTracking = null
  }

  private clearTimers(): void {
    if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.handshakeTimer = null
    this.reconnectTimer = null
    this.stopHeartbeat()
  }

  private resolveHandshake(): void {
    this.handshakeResolve?.()
    this.handshakeResolve = null
    this.handshakeReject = null
    this.handshake = null
  }

  private rejectHandshake(cause: unknown): void {
    this.handshakeReject?.(cause)
    this.handshakeResolve = null
    this.handshakeReject = null
    this.handshake = null
    if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
  }

  private setState(state: RelayTransportState, error: string | null): void {
    this.statusValue = { ...this.statusValue, state, error }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.statusValue)
      } catch {
        // listeners must not break the transport
      }
    }
  }

  private emitPush(state: PushStatusState): void {
    for (const listener of this.pushListeners) {
      try {
        listener(state)
      } catch {
        // listeners must not break the transport
      }
    }
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

function randomId(): string {
  return bytesToBase64Url(randomBytes(16))
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError')
}

/**
 * A refused WebSocket upgrade (Worker 404/401, or a mixed-content block for a
 * `ws://` endpoint on an HTTPS page) closes without a reason, so turn the bare
 * code into something actionable.
 */
const LOCAL_ONLY_MESSAGE =
  'This pairing code is local-only. Configure the relay on the home agent, then pair again.'
const REFUSED_MESSAGE = 'The relay refused the connection. Check the room URL and the client token.'

function describeClose(event: CloseEvent, wsUrl: string, wasOpen: boolean): string {
  if (event.reason) return event.reason
  if (event.code === 1006 || event.code === 1005) {
    if (wasOpen) return 'The connection to the relay dropped. Reconnecting.'
    return refusedReason(wsUrl)
  }
  return `The relay connection closed (code ${event.code}).`
}

function refusedReason(wsUrl: string): string {
  return isBlockedLocalEndpoint(wsUrl) ? LOCAL_ONLY_MESSAGE : REFUSED_MESSAGE
}

function isBlockedLocalEndpoint(wsUrl: string): boolean {
  if (!wsUrl.startsWith('ws://')) return false
  return typeof window !== 'undefined' && window.location?.protocol === 'https:'
}

function isState(
  payload: ClaraAction | ClaraState
): payload is Exclude<ClaraState, { type: 'push.status' }> {
  return (
    payload.type === 'http.response' ||
    payload.type === 'http.chunk' ||
    payload.type === 'http.end' ||
    payload.type === 'http.error' ||
    payload.type === 'agent.status' ||
    payload.type === 'sync.revision' ||
    payload.type === 'sync.snapshot' ||
    payload.type === 'sync.error'
  )
}
