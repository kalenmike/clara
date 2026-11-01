import {
  ReplayGuard,
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
  isHelloFrame,
  isSealedFrame,
  parseWireFrame,
  type AgentInfo,
  type ClaraAction,
  type ClaraState,
  type DeviceClass,
  type PushSubscribeAction,
  type PushTestAction,
  type PushUnsubscribeAction,
  type SyncPullAction,
  type SyncPushAction,
  type WireFrame,
} from '@clara/shared-types'
import { OpenCodeClient, responseHeaders, type HttpRequestAction } from './opencode.ts'
import type { PushService } from './push/service.ts'
import type { ClientStorageStore, SyncResult } from './store/client-storage.ts'

const MAX_REQUESTS_PER_SESSION = 32
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
const CHUNK_BYTES = 32 * 1024
const SESSION_IDLE_MS = 90_000
const SWEEP_MS = 30_000
const PRESENCE_TTL_MS = 60_000

type SessionPresence = {
  at: number
  deviceClass: DeviceClass
  holdPhone: boolean
}

type Session = {
  sid: string
  keys: SessionKeys
  sendSeq: number
  receive: ReplayGuard
  connectedAt: number
  lastSeen: number
  presence?: SessionPresence
  sendChain: Promise<void>
  requests: Map<string, AbortController>
}

export type AgentSessionInfo = {
  sid: string
  connectedAt: number
  lastSeen: number
  requests: number
  deviceClass?: DeviceClass
  presenceAt?: number
  holdPhone: boolean
}

export type AgentPolicy = {
  /** Gate OpenCode proxying without duplicating runtime state in the agent. */
  canProxy?: () => boolean
  /** Gate push actions while keeping stored subscriptions intact. */
  canPush?: () => boolean
}

export type AgentOptions = {
  openCode: OpenCodeClient
  psk: string
  info: AgentInfo
  send: (frame: WireFrame) => void
  push?: PushService
  sync?: ClientStorageStore
  policy?: AgentPolicy
  log?: (message: string, detail?: unknown) => void
}

/**
 * One Agent serves every client attached to a single transport (the local WS
 * listener or the relay). Sessions are independent and keyed by the client's
 * random sid, so the relay can broadcast every agent frame without routing
 * state.
 */
export class Agent {
  private readonly sessions = new Map<string, Session>()
  private readonly sweepTimer: NodeJS.Timeout
  private readonly options: AgentOptions

  constructor(options: AgentOptions) {
    this.options = options
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS)
    this.sweepTimer.unref()
  }

  handleMessage(raw: string | Uint8Array | ArrayBuffer): void {
    let text: string
    try {
      text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    } catch {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }

    const frame = parseWireFrame(parsed)
    if (!frame) return

    if (isHelloFrame(frame)) {
      void this.handleHello(frame.sid, frame.nonce, frame.role)
      return
    }
    if (isSealedFrame(frame)) {
      void this.handleSealed(frame)
    }
  }

  reset(): void {
    for (const session of this.sessions.values()) this.abortSession(session)
    this.sessions.clear()
  }

  close(): void {
    clearInterval(this.sweepTimer)
    this.reset()
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  /**
   * Read-only view of the live E2EE sessions. Keys and replay state stay inside
   * the agent; only display metadata is exposed to the local panel.
   */
  getSnapshot(now = Date.now()): AgentSessionInfo[] {
    const sessions: AgentSessionInfo[] = []
    for (const session of this.sessions.values()) {
      const presence = session.presence
      const presenceActive = presence !== undefined && now - presence.at <= PRESENCE_TTL_MS
      sessions.push({
        sid: session.sid,
        connectedAt: session.connectedAt,
        lastSeen: session.lastSeen,
        requests: session.requests.size,
        ...(presence?.deviceClass ? { deviceClass: presence.deviceClass } : {}),
        ...(presence ? { presenceAt: presence.at } : {}),
        holdPhone: presenceActive && presence.holdPhone,
      })
    }
    return sessions.sort((left, right) => left.connectedAt - right.connectedAt)
  }

  /**
   * True while a desktop client reports that it is visible and recently used.
   * Mobile pushes are held during that window so a desk user is not alerted on
   * both devices.
   */
  deskHoldActive(now = Date.now()): boolean {
    for (const session of this.sessions.values()) {
      const presence = session.presence
      if (!presence || presence.deviceClass !== 'desktop' || !presence.holdPhone) continue
      if (now - presence.at > PRESENCE_TTL_MS) continue
      return true
    }
    return false
  }

  private async handleHello(
    sid: string,
    clientNonce: string,
    role: 'agent' | 'client'
  ): Promise<void> {
    if (role !== 'client' || !sid || !clientNonce) return

    const existing = this.sessions.get(sid)
    if (existing) this.abortSession(existing)

    const agentNonce = bytesToBase64Url(randomBytes(16))
    let keys: SessionKeys
    try {
      keys = await deriveSessionKeys({
        psk: this.options.psk,
        sid,
        clientNonce,
        agentNonce,
      })
    } catch (cause) {
      this.options.log?.('handshake failed', cause)
      return
    }

    const session: Session = {
      sid,
      keys,
      sendSeq: 0,
      receive: new ReplayGuard(),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      sendChain: Promise.resolve(),
      requests: new Map(),
    }
    this.sessions.set(sid, session)

    this.options.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid,
      nonce: agentNonce,
      role: 'agent',
    })
    this.enqueue(session, { type: 'ready', agent: this.options.info })
  }

  private async handleSealed(frame: Extract<WireFrame, { t: 'sealed' }>): Promise<void> {
    const session = this.sessions.get(frame.sid)
    if (!session) return
    session.lastSeen = Date.now()

    try {
      session.receive.check(frame.seq)
    } catch (cause) {
      this.options.log?.('rejected an out-of-order frame', cause)
      this.abortSession(session)
      this.sessions.delete(frame.sid)
      return
    }

    let plaintext: Uint8Array<ArrayBuffer>
    try {
      plaintext = await open(
        session.keys.c2s,
        { sid: session.sid, direction: 'c2s', seq: frame.seq },
        frame
      )
    } catch (cause) {
      this.options.log?.('could not decrypt a client frame', cause)
      this.abortSession(session)
      this.sessions.delete(frame.sid)
      return
    }

    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
      this.abortSession(session)
      this.sessions.delete(frame.sid)
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(plaintext))
    } catch {
      return
    }
    if (!isClaraPayload(payload)) return
    this.handlePayload(session, payload)
  }

  private handlePayload(session: Session, payload: ClaraAction | ClaraState): void {
    switch (payload.type) {
      case 'ready.ack':
        return
      case 'ping':
        this.recordPresence(session, payload.presence)
        this.enqueue(session, { type: 'pong', at: payload.at })
        return
      case 'pong':
        return
      case 'http.abort':
        session.requests.get(payload.id)?.abort()
        return
      case 'http.request':
        this.startRequest(session, payload)
        return
      case 'push.subscribe':
        void this.handlePushSubscribe(session, payload)
        return
      case 'push.unsubscribe':
        void this.handlePushUnsubscribe(session, payload)
        return
      case 'push.test':
        void this.handlePushTest(session, payload)
        return
      case 'sync.pull':
        void this.handleSyncPull(session, payload)
        return
      case 'sync.push':
        void this.handleSyncPush(session, payload)
        return
      default:
        return
    }
  }

  private recordPresence(session: Session, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const deviceClass = record.deviceClass
    if (deviceClass !== 'desktop' && deviceClass !== 'mobile') return
    session.presence = {
      at: Date.now(),
      deviceClass,
      holdPhone: record.holdPhone === true,
    }
  }

  private async handlePushSubscribe(session: Session, action: PushSubscribeAction): Promise<void> {
    if (!this.canPush()) {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        error: 'Push notifications are disabled by an admin setting',
      })
      return
    }

    const push = this.options.push
    const endpoint = action.subscription?.endpoint
    if (!push) {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: typeof endpoint === 'string' ? endpoint : undefined,
        error: 'Push notifications are not available on this server',
      })
      return
    }

    try {
      const result = push.subscribe(action.subscription, {
        userAgent: action.userAgent,
        deviceClass: action.deviceClass,
      })
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: true,
        endpoint: result.endpoint,
        count: result.count,
      })
    } catch (cause) {
      this.options.log?.('could not save a push subscription', cause)
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: typeof endpoint === 'string' ? endpoint : undefined,
        error: errorMessage(cause),
      })
    }
  }

  private async handlePushUnsubscribe(
    session: Session,
    action: PushUnsubscribeAction
  ): Promise<void> {
    if (!this.canPush()) {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: typeof action.endpoint === 'string' ? action.endpoint : undefined,
        error: 'Push notifications are disabled by an admin setting',
      })
      return
    }

    const push = this.options.push
    if (!push || typeof action.endpoint !== 'string') {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: typeof action.endpoint === 'string' ? action.endpoint : undefined,
        error: push ? 'The push endpoint is invalid' : 'Push notifications are not available',
      })
      return
    }

    try {
      const result = push.unsubscribe(action.endpoint)
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: action.endpoint,
        count: result.count,
      })
    } catch (cause) {
      this.options.log?.('could not remove a push subscription', cause)
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: true,
        endpoint: action.endpoint,
        error: errorMessage(cause),
      })
    }
  }

  private async handlePushTest(session: Session, action: PushTestAction): Promise<void> {
    if (!this.canPush()) {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        endpoint: action.endpoint,
        tested: true,
        error: 'Push notifications are disabled by an admin setting',
      })
      return
    }

    const push = this.options.push
    if (!push) {
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: false,
        error: 'Push notifications are not available on this server',
      })
      return
    }

    const isSubscribed = () => (action.endpoint ? push.has(action.endpoint) : push.count > 0)

    try {
      const result = await push.test(action.endpoint)
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: isSubscribed(),
        endpoint: action.endpoint,
        count: result.count,
        tested: true,
      })
    } catch (cause) {
      this.options.log?.('could not send a test push', cause)
      this.enqueue(session, {
        type: 'push.status',
        id: action.id,
        subscribed: isSubscribed(),
        endpoint: action.endpoint,
        tested: true,
        error: errorMessage(cause),
      })
    }
  }

  private handleSyncPull(session: Session, action: SyncPullAction): void {
    const sync = this.options.sync
    const id = typeof action.id === 'string' ? action.id : ''
    if (!sync) {
      this.enqueue(session, {
        type: 'sync.error',
        id,
        code: 'storage',
        message: 'Client sync storage is not available on this agent',
      })
      return
    }

    const result = sync.pull(action.namespace)
    this.enqueueSyncResult(session, id, result)
  }

  private handleSyncPush(session: Session, action: SyncPushAction): void {
    const sync = this.options.sync
    const id = typeof action.id === 'string' ? action.id : ''
    if (!sync) {
      this.enqueue(session, {
        type: 'sync.error',
        id,
        code: 'storage',
        message: 'Client sync storage is not available on this agent',
      })
      return
    }

    const result = sync.push(action, session.sid)
    this.enqueueSyncResult(session, id, result)
  }

  private enqueueSyncResult(
    session: Session,
    id: string,
    result: SyncResult
  ): void {
    if (result.ok) {
      this.enqueue(session, {
        type: 'sync.snapshot',
        id,
        namespace: result.snapshot.namespace,
        revision: result.snapshot.revision,
        entries: result.snapshot.entries,
      })
      return
    }

    this.enqueue(session, {
      type: 'sync.error',
      id,
      code: result.code,
      message: result.message,
      ...(result.namespace ? { namespace: result.namespace } : {}),
      ...(result.snapshot
        ? { revision: result.snapshot.revision, entries: result.snapshot.entries }
        : {}),
    })
  }

  private canPush(): boolean {
    return this.options.policy?.canPush?.() ?? true
  }

  private startRequest(session: Session, action: HttpRequestAction): void {
    if (this.options.policy?.canProxy && !this.options.policy.canProxy()) {
      this.enqueue(session, {
        type: 'http.error',
        id: action.id,
        code: 'disabled',
        message: 'OpenCode access is disabled by an admin setting',
      })
      return
    }
    if (typeof action.id !== 'string' || action.id.length === 0 || action.id.length > 128) return
    if (session.requests.has(action.id)) return
    if (session.requests.size >= MAX_REQUESTS_PER_SESSION) {
      this.enqueue(session, {
        type: 'http.error',
        id: action.id,
        code: 'too_many_requests',
        message: 'Too many concurrent requests in this session',
      })
      return
    }

    const controller = new AbortController()
    session.requests.set(action.id, controller)
    void this.runRequest(session, action, controller)
  }

  private async runRequest(
    session: Session,
    action: HttpRequestAction,
    controller: AbortController
  ): Promise<void> {
    try {
      const response = await this.options.openCode.request(action, controller.signal)
      this.enqueue(session, {
        type: 'http.response',
        id: action.id,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response.headers),
      })

      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            for (const chunk of splitChunks(value)) {
              this.enqueue(session, {
                type: 'http.chunk',
                id: action.id,
                data: bytesToBase64Url(chunk),
              })
            }
          }
        } finally {
          reader.releaseLock()
        }
      }

      this.enqueue(session, { type: 'http.end', id: action.id })
    } catch (cause) {
      const aborted = controller.signal.aborted
      this.enqueue(session, {
        type: 'http.error',
        id: action.id,
        code: aborted ? 'aborted' : 'upstream_error',
        message: aborted ? 'Request aborted' : errorMessage(cause),
      })
    } finally {
      session.requests.delete(action.id)
    }
  }

  private enqueue(session: Session, payload: ClaraAction | ClaraState): void {
    const text = JSON.stringify(payload)
    const next = session.sendChain
      .then(async () => {
        if (!this.sessions.has(session.sid)) return
        const seq = session.sendSeq
        session.sendSeq += 1
        const box = await seal(
          session.keys.s2c,
          { sid: session.sid, direction: 's2c', seq },
          utf8(text)
        )
        this.options.send({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid: session.sid,
          seq,
          iv: box.iv,
          ct: box.ct,
        })
      })
      .catch((cause) => {
        this.options.log?.('could not send an agent frame', cause)
      })
    session.sendChain = next
  }

  private abortSession(session: Session): void {
    for (const controller of session.requests.values()) controller.abort()
    session.requests.clear()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [sid, session] of this.sessions) {
      if (now - session.lastSeen <= SESSION_IDLE_MS) continue
      this.abortSession(session)
      this.sessions.delete(sid)
    }
  }
}

function splitChunks(value: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < value.byteLength; offset += CHUNK_BYTES) {
    chunks.push(new Uint8Array(value.slice(offset, offset + CHUNK_BYTES)))
  }
  return chunks
}

function isClaraPayload(value: unknown): value is ClaraAction | ClaraState {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
