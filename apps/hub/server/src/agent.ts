import {
  ReplayGuard,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  open,
  randomBytes,
  seal,
  utf8,
  type V4SessionKeys,
} from '@clara/crypto'
import {
  DEVICE_GRANT_TTL_SECONDS,
  PROTOCOL_VERSION,
  createRelayGrant,
  isClientHelloFrameV4,
  isRouteFrameV3,
  isSealedFrame,
  parseWireFrame,
  type AdapterAction,
  type AdapterEnrollAction,
  type AdapterState,
  type AgentInfo,
  type ClaraAction,
  type ClaraPayload,
  type ClaraState,
  type ClientHelloFrameV4,
  type DeviceClass,
  type DeviceEnrollAction,
  type DeviceErrorCode,
  type HubHelloFrameV4,
  type PanelTransport,
  type PushSubscribeAction,
  type PushTestAction,
  type PushUnsubscribeAction,
  type RelayGrantState,
  type SyncCheckAction,
  type SyncPullAction,
  type SyncPushAction,
  type WireFrame,
} from '@clara/shared-types'
import type { ApiApp } from './api/context.ts'
import { responseHeaders, type HttpRequestAction } from './http.ts'
import { AdapterSessionBridge } from './harness/session.ts'
import type { PushService } from './push/service.ts'
import type { ClientStorageStore, SyncCheckResult, SyncResult } from './store/client-storage.ts'
import type { DeviceRegistry } from './store/devices.ts'
import { DeviceStoreError } from './store/devices.ts'
import type { TrafficMeter } from './traffic.ts'

const MAX_REQUESTS_PER_SESSION = 64
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
const CHUNK_BYTES = 32 * 1024
const SESSION_IDLE_MS = 90_000
const SWEEP_MS = 30_000
const PRESENCE_TTL_MS = 60_000

/**
 * Live E2EE sessions per transport. A typical install has a phone, a desktop,
 * a PWA, and one or two adapters; 64 leaves generous room for all of them while
 * keeping the cost of a stolen relay grant bounded. Existing sessions are
 * never evicted to admit a new one, because that would kick a working client.
 */
export const MAX_SESSIONS = 64

/** Handshakes in flight. Keeping this at the session cap bounds database work. */
const MAX_PENDING_PEERS = 64

/**
 * Ten hellos per ten seconds per relay peer. A reconnect after a network blip
 * uses one or two; a flood is dropped before it can reach the device store. The
 * window bounds the counter map as well, since old entries are pruned.
 */
const HELLO_WINDOW_MS = 10_000
export const MAX_HELLOS_PER_WINDOW = 10

/** Hard cap on retained hello counters if peer churn outpaces the room cap. */
const MAX_HELLO_PEERS = 256

type SessionPresence = {
  at: number
  deviceClass: DeviceClass
  holdPhone: boolean
}

type SessionKind = 'device' | 'enroll' | 'adapter'

/** Hello budget for one relay peer; `warned` keeps logging to once per window. */
type HelloWindow = { since: number; count: number; warned: boolean }

/** Whether frames arrive bare or wrapped in the relay's route envelope. */
type AgentEnvelope = 'plain' | 'relay'

type Session = {
  sid: string
  kind: SessionKind
  /** Relay-assigned socket that opened the session; absent on the local transport. */
  peer?: string
  /** Verified grant id from the relay envelope; the audit identity of the session. */
  grantId?: string
  deviceId?: string
  deviceLabel?: string
  enrollId?: string
  pairToken?: string
  adapterId?: string
  harnessId?: string
  adapterBridge?: AdapterSessionBridge
  adapterFetch?: (request: Request) => Promise<Response>
  isAdapter?: boolean
  keys: V4SessionKeys
  sendSeq: number
  receive: ReplayGuard
  connectedAt: number
  lastSeen: number
  presence?: SessionPresence
  sendChain: Promise<void>
  receiveChain: Promise<void>
  requests: Map<string, AbortController>
  /** Traffic counters, frozen while monitoring is off. */
  bytesIn: number
  bytesOut: number
  requestsTotal: number
}

export type AgentSessionInfo = {
  sid: string
  kind: SessionKind
  deviceId?: string
  deviceLabel?: string
  adapterId?: string
  harnessId?: string
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

export type AdapterSessionHandler = {
  pairingToken: (id: string) => Promise<string | undefined>
  credential: (
    adapterId: string
  ) => Promise<{ adapterId: string; harnessId: string; key: string } | undefined>
  enroll: (
    action: AdapterEnrollAction,
    pairToken: string,
    transport: PanelTransport
  ) => Promise<{
    connection: { id: string; harnessId: string; label: string }
    reconnected: boolean
  }>
  setLive: (
    harnessId: string,
    fetch: (request: Request) => Promise<Response>,
    transport: PanelTransport
  ) => Promise<void>
  clearLive: (harnessId: string, fetch?: (request: Request) => Promise<Response>) => Promise<void>
}

/**
 * Signs the relay grants a paired client presents on its next connection. The
 * relay transport supplies it from the same credentials the hub socket uses;
 * the local transport has none, so local sessions need no grant.
 */
export type AgentRelayGrants = {
  room: string
  agentToken: string
}

export type AgentPolicy = {
  /** Gate push actions while keeping stored subscriptions intact. */
  canPush?: () => boolean
  /** Gate client settings sync without deleting the stored namespace. */
  canSync?: () => boolean
}

export type AgentOptions = {
  /** The Clara API. Every browser request is routed through it. */
  api: ApiApp
  devices: DeviceRegistry
  info: AgentInfo
  send: (frame: WireFrame) => void
  push?: PushService
  sync?: ClientStorageStore
  policy?: AgentPolicy
  /** Shared traffic counters for the panel; absent in tests. */
  traffic?: TrafficMeter
  adapters?: AdapterSessionHandler
  /** Which transport this hub service serves, for the per-transport split. */
  transport?: PanelTransport
  log?: (message: string, detail?: unknown) => void
}

/**
 * One `Agent` instance serves every client attached to a single transport (the local WS
 * listener or the relay). Sessions are independent and keyed by the client's
 * random sid, so the relay can broadcast every hub frame without routing
 * state. On the relay transport each session is additionally bound to the
 * relay-assigned peer of the socket that opened it.
 */
export class Agent {
  private readonly sessions = new Map<string, Session>()
  /** Sid to peer for a handshake that is still being established. */
  private readonly pendingPeers = new Map<string, string>()
  /** Per-relay-peer hello budgets; reset with the transport, not across reconnects. */
  private readonly helloWindows = new Map<string, HelloWindow>()
  private readonly sweepTimer: NodeJS.Timeout
  private readonly options: AgentOptions
  private envelopeMode: AgentEnvelope = 'plain'
  private grantIssuer: AgentRelayGrants | undefined
  private warnedUnwrapped = false

  constructor(options: AgentOptions) {
    this.options = options
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS)
    this.sweepTimer.unref()
  }

  /**
   * Select the wire envelope. The relay wraps every client frame in a route
   * frame that names the sending socket, so sessions can be bound to a peer.
   * The local transport keeps speaking bare frames.
   */
  setEnvelope(mode: AgentEnvelope): void {
    this.envelopeMode = mode
  }

  /**
   * Supply the relay credentials used to sign device and adapter grants. The
   * relay client calls this with the room and agent token it connects with.
   */
  setGrantIssuer(issuer: AgentRelayGrants | undefined): void {
    this.grantIssuer = issuer
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
      this.options.traffic?.recordError('dropped')
      return
    }

    let peer: string | undefined
    let grantId: string | undefined
    if (this.envelopeMode === 'relay') {
      if (!isRouteFrameV3(parsed)) {
        // A route frame without the verified grant id is a protocol error: an
        // older Worker cannot prove who opened the socket. Anything else is an
        // unwrapped frame from an outdated relay.
        if (isRouteShaped(parsed)) {
          this.options.traffic?.recordError('dropped')
          return
        }
        if (!this.warnedUnwrapped) {
          this.warnedUnwrapped = true
          this.options.log?.('ignored an unwrapped relay frame; the relay is outdated')
        }
        return
      }
      peer = parsed.p
      grantId = parsed.i
      try {
        text = parsed.b ? new TextDecoder().decode(base64UrlToBytes(parsed.m)) : parsed.m
        parsed = JSON.parse(text)
      } catch {
        this.options.traffic?.recordError('dropped')
        return
      }
    }

    const bytes = Buffer.byteLength(text)

    if (isClientHelloFrameV4(parsed)) {
      this.options.traffic?.recordInbound(bytes, this.transport)
      const hello = parsed
      void this.handleHello(hello, peer, grantId).catch((cause) => {
        this.options.log?.('handshake failed', cause)
        this.sendError(hello.sid, 'invalid_device', 'Could not start the session')
      })
      return
    }

    const frame = parseWireFrame(parsed)
    if (!frame) {
      this.options.traffic?.recordError('dropped')
      return
    }

    this.options.traffic?.recordInbound(bytes, this.transport)

    if (frame.t === 'hello') {
      // The hub speaks handshake v4 only; a v3-style hello has no ephemeral
      // point to derive a forward-secret session from.
      this.options.traffic?.recordError('dropped')
      return
    }
    if (isSealedFrame(frame)) {
      const session = this.sessions.get(frame.sid)
      if (!session) {
        // A sealed frame for a session this instance does not hold is either a
        // stale client or someone probing with a guessed session id.
        this.options.traffic?.recordError('orphan')
        return
      }
      if (this.envelopeMode === 'relay' && session.peer !== peer) {
        // The relay told us which socket sent this frame. Serving it would let
        // any room member replay garbage into another member's session.
        this.options.traffic?.recordError('misrouted')
        this.options.log?.(
          'dropped a frame from another relay peer',
          `sid=${frame.sid} grant=${session.grantId ?? 'none'}`
        )
        return
      }
      if (this.monitoring) session.bytesIn += bytes
      // AES-GCM is asynchronous, so decryption can finish out of order. Keep
      // every frame in arrival order for this session; otherwise an adapter's
      // `end` can overtake its `response` and leave the request pending.
      session.receiveChain = session.receiveChain
        .then(() => this.handleSealed(session, frame))
        .catch((cause) => {
          this.options.log?.('could not process a client frame', cause)
        })
    }
  }

  reset(): void {
    // Go through closeSession so adapter sessions also clear their live fetch.
    // Leaving a stale fetch behind makes every later harness request hang.
    for (const session of [...this.sessions.values()]) this.closeSession(session)
    this.helloWindows.clear()
  }

  /**
   * Drop one session when its transport socket closes. The local listener owns
   * one client per socket, so this clears the adapter's online state promptly
   * instead of waiting for the idle sweep.
   */
  disconnect(sid: string): void {
    const session = this.sessions.get(sid)
    if (session) this.closeSession(session)
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
   * the instance; only display metadata is exposed to the local panel.
   */
  getSnapshot(now = Date.now()): AgentSessionInfo[] {
    const sessions: AgentSessionInfo[] = []
    for (const session of this.sessions.values()) {
      const presence = session.presence
      const presenceActive = presence !== undefined && now - presence.at <= PRESENCE_TTL_MS
      sessions.push({
        sid: session.sid,
        kind: session.kind,
        ...(session.deviceId ? { deviceId: session.deviceId } : {}),
        ...(session.deviceLabel ? { deviceLabel: session.deviceLabel } : {}),
        ...(session.adapterId ? { adapterId: session.adapterId } : {}),
        ...(session.harnessId ? { harnessId: session.harnessId } : {}),
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
    frame: ClientHelloFrameV4,
    peer?: string,
    grantId?: string
  ): Promise<void> {
    const { sid } = frame

    const relayPeer = this.envelopeMode === 'relay' ? peer : undefined
    const relayGrant = this.envelopeMode === 'relay' ? grantId : undefined
    // The local transport has its own one-client-per-socket model and does not
    // pass through these limits; only relay peers are metered.
    if (relayPeer !== undefined && !this.allowHello(relayPeer)) return

    const existing = this.sessions.get(sid)
    if (existing) {
      // A relay session belongs to the socket that opened it. A hello reusing
      // its sid from another peer is an attempted takeover: drop the hello and
      // leave the live session untouched.
      if (relayPeer !== undefined && existing.peer !== relayPeer) {
        this.options.log?.(
          'dropped a hello from another relay peer',
          `sid=${sid} grant=${relayGrant ?? 'none'}`
        )
        return
      }
      this.closeSession(existing)
    } else if (relayPeer !== undefined) {
      // In-flight handshakes are reservations: counting them here stops two
      // racing hellos from both passing the cap and creating the 65th session.
      if (this.pendingPeers.size >= MAX_PENDING_PEERS && !this.pendingPeers.has(sid)) {
        this.options.log?.('refused a hello at the pending handshake limit', `sid=${sid}`)
        return
      }
      if (this.sessions.size + this.pendingPeers.size >= MAX_SESSIONS) {
        // `device_limit` is a credential-dead code (the device registry is
        // full), so a transient hub capacity refusal must use `not_allowed`
        // to let the browser reconnect with backoff.
        this.sendError(sid, 'not_allowed', 'The hub is at its session limit; retry shortly')
        return
      }
      // Refuse a different peer while the first handshake is still in flight.
      const pending = this.pendingPeers.get(sid)
      if (pending !== undefined && pending !== relayPeer) {
        this.options.log?.(
          'dropped a hello from another relay peer',
          `sid=${sid} grant=${relayGrant ?? 'none'}`
        )
        return
      }
    }

    if (relayPeer !== undefined) this.pendingPeers.set(sid, relayPeer)
    try {
      await this.establishSession(frame, relayPeer, relayGrant)
    } finally {
      if (relayPeer !== undefined) this.pendingPeers.delete(sid)
    }
  }

  /**
   * Charge one hello to a relay peer. Refusals happen before any device or
   * adapter lookup, so a hello flood costs counters instead of database reads.
   */
  private allowHello(peer: string): boolean {
    const now = Date.now()
    let window = this.helloWindows.get(peer)
    if (!window || now - window.since >= HELLO_WINDOW_MS) {
      window = { since: now, count: 0, warned: false }
      this.rememberHelloWindow(peer, window)
    } else {
      // Refresh insertion order so the least recently seen peer is evicted.
      this.helloWindows.delete(peer)
      this.helloWindows.set(peer, window)
    }

    if (window.count >= MAX_HELLOS_PER_WINDOW) {
      if (!window.warned) {
        window.warned = true
        this.options.traffic?.recordError('limited')
        this.options.log?.('dropped hellos above the relay peer limit', `peer=${peer}`)
      }
      return false
    }
    window.count += 1
    return true
  }

  private rememberHelloWindow(peer: string, window: HelloWindow): void {
    if (this.helloWindows.size >= MAX_HELLO_PEERS) {
      const oldest = this.helloWindows.keys().next().value
      if (oldest !== undefined) this.helloWindows.delete(oldest)
    }
    this.helloWindows.set(peer, window)
  }

  private async establishSession(
    frame: ClientHelloFrameV4,
    peer?: string,
    grantId?: string
  ): Promise<void> {
    const { sid, nonce: clientNonce, eph } = frame

    const isAdapter = frame.adapter === true
    let kind: SessionKind
    let identity: string
    let baseKey: string
    let deviceId: string | undefined
    let deviceLabel: string | undefined
    let enrollId: string | undefined
    let pairToken: string | undefined
    let adapterId: string | undefined
    let harnessId: string | undefined

    if (isAdapter && frame.enrollId) {
      const token = await this.options.adapters?.pairingToken(frame.enrollId)
      if (!token) {
        this.sendError(sid, 'enrollment_invalid', 'The pairing code is invalid or expired')
        return
      }
      kind = 'enroll'
      identity = frame.enrollId
      enrollId = frame.enrollId
      pairToken = token
      baseKey = token
    } else if (isAdapter && frame.adapterId) {
      const credential = await this.options.adapters?.credential(frame.adapterId)
      if (!credential) {
        this.sendError(sid, 'unknown_device', 'This adapter is not enrolled')
        return
      }
      kind = 'adapter'
      identity = credential.adapterId
      adapterId = credential.adapterId
      harnessId = credential.harnessId
      baseKey = credential.key
    } else if (!isAdapter && frame.enrollId) {
      const token = await this.options.devices.findPairingToken(frame.enrollId)
      if (!token) {
        this.sendError(sid, 'enrollment_invalid', 'The pairing code is invalid or expired')
        return
      }
      kind = 'enroll'
      identity = token.id
      enrollId = token.id
      baseKey = token.token
    } else if (!isAdapter && frame.deviceId) {
      const device = await this.options.devices.findActiveDevice(frame.deviceId)
      if (!device) {
        this.sendError(sid, 'unknown_device', 'This device is not enrolled')
        return
      }
      kind = 'device'
      identity = device.id
      deviceId = device.id
      deviceLabel = device.label
      baseKey = device.key
    } else {
      this.sendError(sid, 'invalid_device', 'A device id or enrollment code is required')
      return
    }

    // The relay verified the grant and assigned its id to this socket, so the
    // hello must claim exactly that identity. The hello alone is never trusted.
    if (peer !== undefined && grantId !== identity) {
      this.options.log?.('refused a hello whose identity does not match its grant', {
        sid,
        grant: grantId,
        identity,
      })
      this.sendError(sid, 'invalid_device', 'The session identity does not match the relay grant')
      return
    }

    const agentNonce = bytesToBase64Url(randomBytes(16))
    let keys: V4SessionKeys
    let mac: string
    let agentEphemeral: string
    try {
      const ephemeral = await generateEphemeralKeyPair()
      agentEphemeral = ephemeral.publicKey
      const material = await deriveV4SessionKeys({
        staticKey: baseKey,
        sid,
        nonceC: clientNonce,
        nonceS: agentNonce,
        ephC: eph,
        ephS: ephemeral.publicKey,
        privateKey: ephemeral.privateKey,
        peerPublicKey: eph,
      })
      keys = material.keys
      mac = material.mac
    } catch (cause) {
      this.options.traffic?.recordError('handshake')
      this.options.log?.('handshake failed', cause)
      return
    }

    const session: Session = {
      sid,
      kind,
      ...(peer ? { peer } : {}),
      ...(peer !== undefined && grantId !== undefined ? { grantId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(deviceLabel ? { deviceLabel } : {}),
      ...(enrollId ? { enrollId } : {}),
      ...(pairToken ? { pairToken } : {}),
      ...(adapterId ? { adapterId } : {}),
      ...(harnessId ? { harnessId } : {}),
      ...(isAdapter ? { isAdapter: true } : {}),
      keys,
      sendSeq: 0,
      receive: new ReplayGuard(),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      sendChain: Promise.resolve(),
      receiveChain: Promise.resolve(),
      requests: new Map(),
      bytesIn: 0,
      bytesOut: 0,
      requestsTotal: 0,
    }
    this.sessions.set(sid, session)
    this.options.traffic?.recordSessionOpened()

    if (deviceId) this.options.devices.touchDevice(deviceId, { transport: this.transport })

    if (kind === 'adapter' && harnessId) {
      session.adapterBridge = new AdapterSessionBridge((payload) => this.enqueue(session, payload))
    }

    const hubHello: HubHelloFrameV4 = {
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid,
      nonce: agentNonce,
      role: 'agent',
      eph: agentEphemeral,
      mac,
    }
    this.transmit(undefined, hubHello)

    // An enrollment session has no device or adapter identity yet, so its
    // `ready` carries no grant; the enrollment response delivers the first one.
    const relayGrant = kind === 'enroll' ? undefined : await this.issueRelayGrant(identity)
    this.enqueue(session, {
      type: 'ready',
      agent: this.options.info,
      ...(relayGrant ? { relayGrant } : {}),
    })
    if (kind === 'adapter' && harnessId && session.adapterBridge) {
      const fetch = (request: Request) => session.adapterBridge!.fetch(request)
      session.adapterFetch = fetch
      await this.options.adapters?.setLive(harnessId, fetch, this.transport)
    }
  }

  private async handleSealed(
    session: Session,
    frame: Extract<WireFrame, { t: 'sealed' }>
  ): Promise<void> {
    // A queued frame can outlive a session that an earlier frame closed.
    if (this.sessions.get(session.sid) !== session) return
    session.lastSeen = Date.now()

    try {
      session.receive.check(frame.seq)
    } catch (cause) {
      this.options.traffic?.recordError('crypto')
      this.options.log?.('rejected an out-of-order frame', cause)
      // Tell the adapter to reconnect instead of leaving its socket open with
      // a session the hub already dropped.
      this.failSession(session, 'protocol_error', 'The adapter frame sequence was invalid')
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
      this.failSession(session, 'protocol_error', 'The adapter frame could not be decrypted')
      return
    }

    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
      this.options.traffic?.recordError('dropped')
      this.failSession(session, 'protocol_error', 'The adapter frame was too large')
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

  private handlePayload(session: Session, payload: ClaraPayload): void {
    if (session.kind === 'adapter') {
      switch (payload.type) {
        case 'adapter.response':
        case 'adapter.chunk':
        case 'adapter.end':
        case 'adapter.error':
          session.adapterBridge?.handleState(payload)
          return
        case 'ready.ack':
        case 'pong':
          return
        case 'ping':
          this.enqueue(session, { type: 'pong', at: payload.at })
          return
        default:
          this.rejectSession(
            session,
            'not_allowed',
            'Adapter sessions cannot issue browser actions'
          )
          return
      }
    }

    if (session.kind === 'enroll') {
      switch (payload.type) {
        case 'ready.ack':
        case 'pong':
          return
        case 'ping':
          this.recordPresence(session, payload.presence)
          this.enqueue(session, { type: 'pong', at: payload.at })
          return
        case 'device.enroll':
          void this.handleDeviceEnroll(session, payload)
          return
        case 'adapter.enroll':
          if (session.isAdapter) void this.handleAdapterEnroll(session, payload)
          else this.rejectSession(session, 'not_allowed', 'This is a browser pairing code')
          return
        default:
          this.rejectSession(session, 'not_allowed', 'Enrollment sessions cannot issue requests')
          return
      }
    }

    if (session.deviceId && !this.options.devices.isActive(session.deviceId)) {
      this.rejectSession(session, 'revoked_device', 'This device has been revoked')
      return
    }

    switch (payload.type) {
      case 'device.enroll':
        this.rejectSession(session, 'not_allowed', 'This device is already enrolled')
        return
      case 'adapter.enroll':
        this.rejectSession(session, 'not_allowed', 'This session is already enrolled')
        return
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

  private async handleAdapterEnroll(session: Session, action: AdapterEnrollAction): Promise<void> {
    if (!session.enrollId || !this.options.adapters) {
      this.rejectSession(session, 'not_allowed', 'This session cannot enroll an adapter')
      return
    }
    try {
      const result = await this.options.adapters.enroll(
        action,
        session.pairToken ?? '',
        this.transport
      )
      // The adapter must reconnect under its stable credential id, so the first
      // adapter grant is signed for that id and delivered here.
      const relayGrant = await this.issueRelayGrant(action.credentialId)
      this.enqueue(session, {
        type: 'adapter.enrolled',
        connectionId: result.connection.id,
        harnessId: result.connection.harnessId,
        label: result.connection.label,
        reconnected: result.reconnected,
        ...(relayGrant ? { relayGrant } : {}),
      })
      this.closeAfterSend(session)
    } catch (cause) {
      this.sendError(
        session.sid,
        'invalid_device',
        cause instanceof Error ? cause.message : 'Could not enroll this adapter'
      )
      this.closeSession(session)
    }
  }

  private async handleDeviceEnroll(session: Session, action: DeviceEnrollAction): Promise<void> {
    if (!session.enrollId) {
      this.rejectSession(session, 'not_allowed', 'This session cannot enroll a device')
      return
    }

    try {
      const device = await this.options.devices.enrollDevice({
        pairingTokenId: session.enrollId,
        deviceId: action.deviceId,
        key: action.key,
        label: action.label ?? 'Unnamed device',
        transport: this.transport,
        ...(session.presence?.deviceClass ? { deviceClass: session.presence.deviceClass } : {}),
      })
      // The browser reconnects as this device id, which no longer matches the
      // enrollment grant, so hand it the first device grant before closing.
      const relayGrant = await this.issueRelayGrant(device.id)
      this.enqueue(session, {
        type: 'device.enrolled',
        deviceId: device.id,
        fingerprint: device.fingerprint,
        label: device.label,
        ...(relayGrant ? { relayGrant } : {}),
      })
      // The enrollment session exists only to deliver this response. Retire it
      // once the frame is flushed so the panel never reports it as a live client.
      this.closeAfterSend(session)
    } catch (cause) {
      if (cause instanceof DeviceStoreError) {
        this.sendError(session.sid, toDeviceErrorCode(cause.code), cause.message)
        this.closeSession(session)
        return
      }
      this.options.traffic?.recordError('handshake')
      this.options.log?.('could not enroll a device', cause)
      this.sendError(session.sid, 'invalid_device', 'Could not enroll this device')
      this.closeSession(session)
    }
  }

  private rejectSession(session: Session, code: DeviceErrorCode, message: string): void {
    this.sendError(session.sid, code, message)
    this.closeSession(session)
  }

  /**
   * Drop a session after a protocol failure and tell the peer why. An adapter
   * must reconnect after a bad frame; leaving its socket open makes every
   * later request hang against a session the hub no longer holds.
   */
  private failSession(session: Session, code: DeviceErrorCode, message: string): void {
    if (this.sessions.get(session.sid) !== session) return
    this.sendError(session.sid, code, message)
    this.closeSession(session)
  }

  /**
   * Drop one live session, aborting its in-flight requests and recording the
   * close exactly once. The identity check keeps a late callback from deleting
   * a newer session that reused the same sid.
   */
  private closeSession(session: Session): void {
    if (this.sessions.get(session.sid) !== session) return
    this.sessions.delete(session.sid)
    this.abortSession(session)
    if (session.kind === 'adapter' && session.harnessId && session.adapterFetch) {
      void this.options.adapters?.clearLive(session.harnessId, session.adapterFetch)
    }
    this.options.traffic?.recordSessionClosed()
  }

  /**
   * Finish a session after its queued frames have been sealed and sent. Used by
   * enrollment, which only exists to deliver the `device.enrolled` response.
   */
  private closeAfterSend(session: Session): void {
    const pending = session.sendChain
    void pending.then(() => this.closeSession(session))
  }

  /**
   * Sign a fresh relay grant for a device or adapter identity. A long-lived
   * grant is refreshed on every accepted connect; without relay credentials
   * (the local transport) there is nothing to sign.
   */
  private async issueRelayGrant(id: string | undefined): Promise<RelayGrantState | undefined> {
    const issuer = this.grantIssuer
    if (!issuer || !id || !issuer.agentToken) return undefined
    try {
      return await createRelayGrant({
        room: issuer.room,
        id,
        agentToken: issuer.agentToken,
        ttlSeconds: DEVICE_GRANT_TTL_SECONDS,
      })
    } catch (cause) {
      this.options.log?.('could not sign a relay grant', cause)
      return undefined
    }
  }

  private sendError(sid: string, code: DeviceErrorCode, message: string): void {
    this.options.traffic?.recordError('handshake')
    this.transmit(undefined, {
      t: 'error',
      v: PROTOCOL_VERSION,
      sid,
      code,
      message,
    })
  }

  /** Drop every live session for one device, used after the panel revokes it. */
  abortDevice(deviceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.deviceId === deviceId) this.closeSession(session)
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
    if (session.deviceId) {
      this.options.devices.touchDevice(session.deviceId, {
        transport: this.transport,
        deviceClass,
      })
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
        ...(typeof action.orchestrationOptIn === 'boolean'
          ? { orchestrationOptIn: action.orchestrationOptIn }
          : {}),
        ...(session.deviceId ? { deviceId: session.deviceId } : {}),
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
        message: 'Client sync storage is not available on this hub',
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
        message: 'Client sync storage is not available on this hub',
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
        message: 'Client sync storage is not available on this hub',
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

  /** Tell every connected client that the hub info changed. */
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
    if (typeof action.id !== 'string' || action.id.length === 0 || action.id.length > 128) return
    if (session.requests.has(action.id)) return

    if (!action.path.startsWith('/v1/')) {
      this.respondJsonError(
        session,
        action.id,
        404,
        'Not Found',
        'not_found',
        'Unknown API endpoint'
      )
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
      const response = await this.options.api.fetch(toRequest(action, controller.signal))
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
      if (!aborted) this.options.traffic?.recordError('upstream')
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

  private enqueue(
    session: Session,
    payload: ClaraAction | ClaraState | AdapterAction | AdapterState
  ): void {
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
        this.options.log?.('could not send a hub frame', cause)
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
    session.adapterBridge?.abortAll()
  }

  private sweep(): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen <= SESSION_IDLE_MS) continue
      this.closeSession(session)
      this.options.traffic?.recordError('expired')
    }
    for (const [peer, window] of this.helloWindows) {
      if (now - window.since >= HELLO_WINDOW_MS) this.helloWindows.delete(peer)
    }
  }
}

function toRequest(action: HttpRequestAction, signal: AbortSignal): Request {
  const url = new URL(`http://clara.local${action.path}${action.search ?? ''}`)
  const headers = new Headers(action.headers)
  headers.set('x-clara-agent', '1')
  const body = action.body ? base64UrlToBytes(action.body) : undefined
  return new Request(url, {
    method: action.method,
    headers,
    ...(body ? { body } : {}),
    signal,
  })
}

function splitChunks(value: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < value.byteLength; offset += CHUNK_BYTES) {
    chunks.push(new Uint8Array(value.slice(offset, offset + CHUNK_BYTES)))
  }
  return chunks
}

function toDeviceErrorCode(code: string): DeviceErrorCode {
  switch (code) {
    case 'revoked_device':
    case 'enrollment_expired':
    case 'enrollment_used':
    case 'enrollment_invalid':
    case 'device_limit':
    case 'not_allowed':
      return code
    default:
      return 'invalid_device'
  }
}

function isRouteShaped(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { t?: unknown }).t === 'route'
}

function isClaraPayload(value: unknown): value is ClaraPayload {
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
