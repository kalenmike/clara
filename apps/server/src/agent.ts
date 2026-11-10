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
  type PanelTransport,
  type PushSubscribeAction,
  type PushTestAction,
  type PushUnsubscribeAction,
  type ShellPolicy,
  type SyncCheckAction,
  type SyncPullAction,
  type SyncPushAction,
  type WireFrame,
} from '@clara/shared-types'
import type { HarnessManager } from './harness/manager.ts'
import { HarnessUnconfiguredError } from './harness/types.ts'
import { responseHeaders, type HttpRequestAction } from './opencode.ts'
import type { PushService } from './push/service.ts'
import { DEFAULT_SHELL_POLICY, evaluateShellRequest, type ShellDecision } from './shell-policy.ts'
import type { ClientStorageStore, SyncCheckResult, SyncResult } from './store/client-storage.ts'
import type { TrafficMeter } from './traffic.ts'

const MAX_REQUESTS_PER_SESSION = 64
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
  /** Traffic counters, frozen while monitoring is off. */
  bytesIn: number
  bytesOut: number
  requestsTotal: number
}

export type AgentSessionInfo = {
  sid: string
  connectedAt: number
  lastSeen: number
  requests: number
  bytesIn: number
  bytesOut: number
  requestsTotal: number
  deviceClass?: DeviceClass
  presenceAt?: number
  holdPhone: boolean
}

export type AgentPolicy = {
  /** Gate OpenCode proxying without duplicating runtime state in the agent. */
  canProxy?: () => boolean
  /** Gate push actions while keeping stored subscriptions intact. */
  canPush?: () => boolean
  /** Gate client settings sync without deleting the stored namespace. */
  canSync?: () => boolean
  /**
   * The current command policy, read on every request so a panel change takes
   * effect without a restart. When absent, command requests are blocked.
   */
  shellPolicy?: () => ShellPolicy
  /** Record a refused command request for the panel counter. */
  onShellDenied?: () => void
}

export type AgentOptions = {
  harness: HarnessManager
  psk: string
  info: AgentInfo
  send: (frame: WireFrame) => void
  push?: PushService
  sync?: ClientStorageStore
  policy?: AgentPolicy
  /** Shared traffic counters for the panel; absent in tests. */
  traffic?: TrafficMeter
  /** Which transport this agent serves, for the per-transport split. */
  transport?: PanelTransport
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
    const bytes = Buffer.byteLength(text)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      this.options.traffic?.recordError('dropped')
      return
    }

    const frame = parseWireFrame(parsed)
    if (!frame) {
      this.options.traffic?.recordError('dropped')
      return
    }

    this.options.traffic?.recordInbound(bytes, this.transport)

    if (isHelloFrame(frame)) {
      void this.handleHello(frame.sid, frame.nonce, frame.role)
      return
    }
    if (isSealedFrame(frame)) {
      const session = this.sessions.get(frame.sid)
      if (!session) {
        // A sealed frame for a session this agent does not hold is either a
        // stale client or someone probing with a guessed session id.
        this.options.traffic?.recordError('orphan')
        return
      }
      if (this.monitoring) session.bytesIn += bytes
      void this.handleSealed(session, frame)
    }
  }

  reset(): void {
    for (const session of this.sessions.values()) {
      this.abortSession(session)
      this.options.traffic?.recordSessionClosed()
    }
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
        bytesIn: session.bytesIn,
        bytesOut: session.bytesOut,
        requestsTotal: session.requestsTotal,
        ...(presence?.deviceClass ? { deviceClass: presence.deviceClass } : {}),
        ...(presence ? { presenceAt: presence.at } : {}),
        holdPhone: presenceActive && presence.holdPhone,
      })
    }
    return sessions.sort((left, right) => left.connectedAt - right.connectedAt)
  }

  private get transport(): PanelTransport {
    return this.options.transport ?? 'local'
  }

  private get monitoring(): boolean {
    return this.options.traffic?.enabled ?? false
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
    if (existing) {
      this.abortSession(existing)
      this.options.traffic?.recordSessionClosed()
    }

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
      this.options.traffic?.recordError('handshake')
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
      bytesIn: 0,
      bytesOut: 0,
      requestsTotal: 0,
    }
    this.sessions.set(sid, session)
    this.options.traffic?.recordSessionOpened()

    this.transmit(undefined, {
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid,
      nonce: agentNonce,
      role: 'agent',
    })
    this.enqueue(session, { type: 'ready', agent: this.options.info })
  }

  private async handleSealed(
    session: Session,
    frame: Extract<WireFrame, { t: 'sealed' }>
  ): Promise<void> {
    session.lastSeen = Date.now()

    try {
      session.receive.check(frame.seq)
    } catch (cause) {
      this.options.traffic?.recordError('crypto')
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
      this.options.traffic?.recordError('crypto')
      this.options.log?.('could not decrypt a client frame', cause)
      this.abortSession(session)
      this.sessions.delete(frame.sid)
      return
    }

    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
      this.options.traffic?.recordError('dropped')
      this.abortSession(session)
      this.sessions.delete(frame.sid)
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(plaintext))
    } catch {
      this.options.traffic?.recordError('dropped')
      return
    }
    if (!isClaraPayload(payload)) {
      this.options.traffic?.recordError('dropped')
      return
    }
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
      case 'sync.check':
        void this.handleSyncCheck(session, payload)
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

  private handleSyncCheck(session: Session, action: SyncCheckAction): void {
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
    if (!this.canSync()) {
      this.enqueueSyncDisabled(session, id)
      return
    }

    this.enqueueSyncCheckResult(session, id, sync.check(action.namespace))
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
    if (!this.canSync()) {
      this.enqueueSyncDisabled(session, id)
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
    if (!this.canSync()) {
      this.enqueueSyncDisabled(session, id)
      return
    }

    const result = sync.push(action, session.sid)
    this.enqueueSyncResult(session, id, result)
  }

  private enqueueSyncCheckResult(session: Session, id: string, result: SyncCheckResult): void {
    if (result.ok) {
      this.enqueue(session, {
        type: 'sync.revision',
        id,
        namespace: result.namespace,
        revision: result.revision,
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

  private enqueueSyncDisabled(session: Session, id: string): void {
    this.enqueue(session, {
      type: 'sync.error',
      id,
      code: 'disabled',
      message: 'Client settings sync is disabled by an admin setting',
    })
  }

  private enqueueSyncResult(session: Session, id: string, result: SyncResult): void {
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

  private canSync(): boolean {
    return this.options.policy?.canSync?.() ?? true
  }

  /** Tell every connected client that the agent info changed. */
  broadcastAgentInfo(): void {
    if (this.sessions.size === 0) return
    const payload = { type: 'agent.status' as const, online: true, agent: this.options.info }
    for (const session of this.sessions.values()) this.enqueue(session, payload)
  }

  /** Send one state to every connected client on this transport. */
  broadcastState(payload: ClaraState): void {
    if (this.sessions.size === 0) return
    for (const session of this.sessions.values()) this.enqueue(session, payload)
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

    if (!this.options.harness.configured) {
      this.respondJsonError(
        session,
        action.id,
        503,
        'Service Unavailable',
        'harness_unconfigured',
        'No harness connection is configured. Set one up in the agent panel.'
      )
      return
    }

    const decision = evaluateShellRequest(
      this.options.policy?.shellPolicy?.() ?? DEFAULT_SHELL_POLICY,
      action
    )
    if (!decision.allowed) {
      this.options.traffic?.recordError('refused')
      this.options.policy?.onShellDenied?.()
      this.options.log?.(`refused ${action.method} ${action.path}`, decision.code)
      this.respondRefused(session, action.id, decision)
      return
    }

    if (session.requests.size >= MAX_REQUESTS_PER_SESSION) {
      this.options.traffic?.recordError('limited')
      this.options.log?.(`request limit reached (${MAX_REQUESTS_PER_SESSION})`, {
        sid: session.sid,
        method: action.method,
        path: action.path,
      })
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
    this.options.traffic?.recordRequest(this.transport)
    if (this.monitoring) session.requestsTotal += 1
    void this.runRequest(session, action, controller)
  }

  /**
   * A refused command returns a real HTTP response instead of `http.error`, so
   * the client can tell a policy denial from a transport failure.
   */
  private respondRefused(
    session: Session,
    id: string,
    decision: Exclude<ShellDecision, { allowed: true }>
  ): void {
    this.respondJsonError(
      session,
      id,
      decision.status,
      decision.status === 403 ? 'Forbidden' : 'Bad Request',
      decision.code,
      decision.message
    )
  }

  private respondJsonError(
    session: Session,
    id: string,
    status: number,
    statusText: string,
    code: string,
    message: string
  ): void {
    const body = utf8(JSON.stringify({ error: { code, message } }))
    this.enqueue(session, {
      type: 'http.response',
      id,
      status,
      statusText,
      headers: { 'content-type': 'application/json' },
    })
    this.enqueue(session, { type: 'http.chunk', id, data: bytesToBase64Url(body) })
    this.enqueue(session, { type: 'http.end', id })
  }

  private async runRequest(
    session: Session,
    action: HttpRequestAction,
    controller: AbortController
  ): Promise<void> {
    try {
      const response = await this.options.harness.request(action, controller.signal)
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
      if (!(cause instanceof HarnessUnconfiguredError)) {
        const aborted = controller.signal.aborted
        if (!aborted) this.options.traffic?.recordError('upstream')
        this.enqueue(session, {
          type: 'http.error',
          id: action.id,
          code: aborted ? 'aborted' : 'upstream_error',
          message: aborted ? 'Request aborted' : errorMessage(cause),
        })
      } else {
        this.respondJsonError(
          session,
          action.id,
          503,
          'Service Unavailable',
          cause.code,
          cause.message
        )
      }
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
        this.transmit(session, {
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

  /** Measure an outbound frame once, then hand it to the transport. */
  private transmit(session: Session | undefined, frame: WireFrame): void {
    const bytes = Buffer.byteLength(JSON.stringify(frame))
    this.options.traffic?.recordOutbound(bytes, this.transport)
    if (session && this.monitoring) session.bytesOut += bytes
    this.options.send(frame)
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
      this.options.traffic?.recordError('expired')
      this.options.traffic?.recordSessionClosed()
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
