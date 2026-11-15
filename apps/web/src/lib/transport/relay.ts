import {
  ReplayGuard,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveV4SessionKeys,
  fingerprintKey,
  generateEphemeralKeyPair,
  generateKey,
  importSessionKey,
  open,
  randomBytes,
  seal,
  utf8,
  verifyV4HelloMac,
  type V4SessionKeys,
  type V4EphemeralKeyPair,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  isErrorFrame,
  isHubHelloFrameV4,
  isSealedFrame,
  type AgentInfo,
  type ClaraAction,
  type ClaraState,
  type ClientHelloFrameV4,
  type DeviceErrorCode,
  type RelayGrantState,
  type SyncCheckAction,
  type SyncErrorCode,
  type SyncPullAction,
  type SyncPushAction,
  type SyncSnapshot,
  type WireFrame,
} from '@clara/shared-types'
import { installPresenceTracking, readPresenceSnapshot } from '@/features/notifications/presence'
import {
  RELAY_GRANT_REJECTED_MESSAGE,
  closeReason,
  describeClose,
  refusedReason,
  relayReachable,
} from './relay-close'

const HANDSHAKE_TIMEOUT_MS = 10_000
const REQUEST_HEAD_TIMEOUT_MS = 30_000
const HEARTBEAT_MS = 15_000
const STALL_MS = 45_000
const MAX_RECONNECT_MS = 15_000
const SYNC_TIMEOUT_MS = 30_000

/**
 * The room charges one browser grant 60 frames a second, and every tab paired
 * as the same device shares that grant. Pace below it so an ordinary UI load
 * queues instead of racing into a `4008` refusal: the room forwards no frame
 * after a refusal, so the socket closes and the reload starts over.
 */
export const RELAY_FRAME_RATE = 25
export const RELAY_FRAME_BURST = 10
/** A throttled connection halves its rate down to this floor. */
const MIN_FRAME_RATE = 5

/** Room close codes that mean the connection was refused for volume, not lost. */
const THROTTLE_CLOSE_CODES = new Set([4008, 4009])
const THROTTLE_MESSAGE = 'The relay is throttling this device'
const THROTTLE_RECONNECT_MS = 5_000
/** A connection must hold this long before a throttled rate climbs back. */
const THROTTLE_STABLE_MS = 45_000

/**
 * The hub broadcasts error frames without authentication, so one frame must not
 * be able to park a browser tab offline for good. A credential-dead code has to
 * be seen this many times in a row before the transport stops retrying, which
 * also lets a hub restart or a transient race heal itself.
 */
const CREDENTIAL_DEAD_LIMIT = 3

/** Codes that mean the stored credential cannot ever work again. */
const CREDENTIAL_DEAD_CODES = [
  'revoked_device',
  'unknown_device',
  'enrollment_expired',
  'enrollment_used',
  'enrollment_invalid',
  'device_limit',
] as const satisfies readonly DeviceErrorCode[]

type CredentialDeadCode = (typeof CREDENTIAL_DEAD_CODES)[number]

const CREDENTIAL_DEAD_MESSAGES: Record<CredentialDeadCode, string> = {
  revoked_device:
    'The hub revoked this device. Re-pair this browser, or ask the hub host to re-enable the device.',
  unknown_device:
    'The hub does not recognize this device. Re-pair this browser from the hub panel.',
  enrollment_expired:
    'This pairing code has expired. Generate a new pairing code on the hub and pair again.',
  enrollment_used:
    'This pairing code was already used. Generate a new pairing code on the hub and pair again.',
  enrollment_invalid:
    'The hub rejected this pairing code. Generate a new pairing code on the hub and pair again.',
  device_limit:
    'The hub reached its device limit. Remove a device on the hub, then pair this browser again.',
}

/**
 * The hub accepts a bounded number of requests per session. Keep the web
 * below that ceiling so a feature burst (mailbox signals, project presence,
 * reconnect invalidations) queues instead of failing with too_many_requests.
 */
export const MAX_IN_FLIGHT_REQUESTS = 20

export type RelayCredential =
  | { kind: 'device'; deviceId: string; key: CryptoKey }
  | { kind: 'enroll'; enrollId: string; enrollToken: string; expiresAt: number }

export type RelayTransportConfig = {
  wsUrl: string
  /** The grant presented as `clara.auth.<grant>`. Empty for a local pairing. */
  grant: string
  credential: RelayCredential
  /** Called whenever the hub refreshes the device grant in `ready`. */
  onRelayGrant?: (grant: RelayGrantState) => void
}

/** A device credential returned after a successful enrollment. */
export type EnrolledDevice = {
  kind: 'device'
  deviceId: string
  key: CryptoKey
  fingerprint: string
  label: string
  /** The first device grant, delivered with `device.enrolled`. */
  relayGrant?: RelayGrantState
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
  /**
   * Open a session on demand, clearing a terminal credential error. The UI's
   * retry affordance uses this so recovery never needs a page reload.
   */
  connect: () => Promise<void>
  subscribe: (listener: (status: RelayTransportStatus) => void) => () => void
  subscribePush: (listener: (state: PushStatusState) => void) => () => void
  addChannel: (channel: RelayChannel) => () => void
  requestSync: (action: SyncRequestAction) => Promise<SyncResponse>
  sendAction: (action: ClaraAction) => Promise<void>
  enroll: (label: string) => Promise<EnrolledDevice>
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

type EnrolledSummary = {
  deviceId: string
  fingerprint: string
  label: string
  relayGrant?: RelayGrantState
}

type PendingEnrollment = {
  resolve: (device: EnrolledSummary) => void
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
  private keys: V4SessionKeys | null = null
  private sid: string | null = null
  private clientNonce: string | null = null
  private clientEphemeral: V4EphemeralKeyPair | null = null
  private receive: ReplayGuard | null = null
  private attemptSeq = 0
  private sendChain: Promise<void> = Promise.resolve()
  private receiveChain: Promise<void> = Promise.resolve()
  private sendSeq = 0
  private statusValue: RelayTransportStatus = { state: 'idle', error: null, agent: null }
  private handshake: Promise<void> | null = null
  private handshakeResolve: (() => void) | null = null
  private handshakeReject: ((cause: unknown) => void) | null = null
  private enrollment: PendingEnrollment | null = null
  /** Set only once a credential-dead code repeats past the limit. */
  private terminal: string | null = null
  private deadCode: CredentialDeadCode | null = null
  private deadCount = 0
  private handshakeTimer: number | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private stopPresenceTracking: (() => void) | null = null
  private lastReceivedAt = 0
  private retry = 0
  private closed = false
  /** Frames per second the pacer allows on a relay connection. */
  private frameRate = RELAY_FRAME_RATE
  private frameTokens = RELAY_FRAME_BURST
  private frameRefilledAt = 0
  private readonly frameWaiters: Array<() => void> = []
  private frameTimer: number | null = null
  private frameRecoverTimer: number | null = null

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
    this.failEnrollment(new Error('Relay transport closed'))

    for (const channel of this.channels) channel.close?.(new Error('Relay transport closed'))
    this.channels.clear()
    this.socket?.close(1000, 'client closed')
    this.socket = null
    this.setState('closed', null)
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('Relay transport closed')
    this.clearTerminalError()
    this.retry = 0
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    await this.ensureReady()
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

  async enroll(label: string): Promise<EnrolledDevice> {
    if (this.config.credential.kind !== 'enroll') {
      throw new Error('This transport is not pairing a new device')
    }
    await this.ensureReady()
    if (this.closed) throw new Error('Relay transport closed')

    const deviceId = randomId()
    const rawKey = generateKey()
    const fingerprint = await fingerprintKey(rawKey)

    const enrolled = new Promise<EnrolledSummary>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.enrollment = null
        reject(new Error('Timed out waiting for the home server to enroll this device'))
      }, HANDSHAKE_TIMEOUT_MS)
      this.enrollment = { resolve, reject, timer }
    })

    try {
      await this.send({
        type: 'device.enroll',
        deviceId,
        key: rawKey,
        label,
      })
    } catch (cause) {
      this.failEnrollment(cause)
    }

    const result = await enrolled
    const key = await importSessionKey(rawKey)
    return {
      kind: 'device',
      deviceId: result.deviceId,
      key,
      fingerprint,
      label: result.label,
      ...(result.relayGrant ? { relayGrant: result.relayGrant } : {}),
    }
  }

  status(): RelayTransportStatus {
    return this.statusValue
  }

  /** Only a relay connection presents a grant and is metered by the room. */
  private get metered(): boolean {
    return this.config.grant !== ''
  }

  private async doFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) {
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
    if (this.terminal) throw new Error(this.terminal)
    if (this.config.credential.kind === 'enroll' && Date.now() > this.config.credential.expiresAt) {
      throw new Error('This pairing code has expired')
    }
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
    this.attemptSeq += 1
    const attempt = this.attemptSeq

    const protocols = [RELAY_SUBPROTOCOL, `${RELAY_ROLE_PREFIX}client`]
    if (this.config.grant) protocols.push(`${RELAY_AUTH_PREFIX}${this.config.grant}`)

    let socket: WebSocket
    try {
      socket = new WebSocket(this.config.wsUrl, protocols)
    } catch (cause) {
      this.rejectHandshake(cause)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.lastReceivedAt = Date.now()
    let opened = false
    let refusalHandled = false

    this.handshakeTimer = window.setTimeout(() => {
      this.rejectHandshake(new Error('The home server did not finish the E2EE handshake'))
      socket.close(4000, 'handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      opened = true
      void this.beginHandshake(socket)
    })

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      this.lastReceivedAt = Date.now()
      this.receiveChain = this.receiveChain
        .then(() => {
          // Decryption is asynchronous, so a close can land between arrival and
          // handling. A frame from the dead socket must not revive it.
          if (this.socket !== socket) return
          return this.handleFrame(event.data, socket)
        })
        .catch(() => {})
    })

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return
      if (this.statusValue.state === 'open') {
        this.setState('open', 'The connection to the relay was interrupted')
        return
      }
      const reason = refusedReason(this.config.wsUrl)
      // Browsers follow an error with a close, but not every runtime does, so
      // fail a pending handshake here as well.
      this.rejectHandshake(new Error(reason))
      if (!opened && this.config.grant) {
        if (!refusalHandled) {
          refusalHandled = true
          this.classifyRefusedUpgrade(attempt, reason)
        }
        return
      }
      this.setState(this.statusValue.state, reason)
    })

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      const wasOpen = this.statusValue.state === 'open'
      this.socket = null
      this.keys = null
      this.receive = null
      this.clientEphemeral = null
      this.stopHeartbeat()
      this.releaseFrameWaiters()
      if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      if (this.frameRecoverTimer !== null) window.clearTimeout(this.frameRecoverTimer)
      this.frameRecoverTimer = null
      const reason = describeClose(event, this.config.wsUrl, wasOpen)
      this.rejectHandshake(new Error(reason))
      this.failQueued(new Error(reason))
      this.failAll(new Error(reason))
      this.failAllSync(new Error(reason))
      this.failEnrollment(new Error(reason))

      if (this.closed) return
      if (this.terminal) {
        this.setState('closed', this.terminal)
        return
      }
      if (!opened && refusalHandled) return
      // The room accepted the socket and then refused a frame. That is a volume
      // limit, not a dead credential, so reconnect on a slower schedule.
      if (opened && THROTTLE_CLOSE_CODES.has(event.code)) {
        this.throttled()
        return
      }
      // A failed upgrade cannot expose its HTTP status to a browser. For a relay
      // device or enrollment grant, a reachable relay that still refused means
      // the grant expired, was revoked, or belongs to another relay; retrying
      // cannot fix that. An unreachable relay stays transient.
      if (!opened && this.config.grant) {
        refusalHandled = true
        this.classifyRefusedUpgrade(attempt, reason)
        return
      }
      this.setState('reconnecting', reason)
      this.scheduleReconnect()
    })
  }

  private async beginHandshake(socket: WebSocket): Promise<void> {
    this.sid = randomId()
    this.clientNonce = bytesToBase64Url(randomBytes(16))
    this.sendChain = Promise.resolve()
    this.receiveChain = Promise.resolve()
    this.sendSeq = 0
    this.keys = null
    this.receive = null

    try {
      const ephemeral = await generateEphemeralKeyPair()
      if (this.socket !== socket) return
      this.clientEphemeral = ephemeral
      const credential = this.config.credential
      const hello: ClientHelloFrameV4 = {
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid: this.sid,
        nonce: this.clientNonce,
        role: 'client',
        eph: ephemeral.publicKey,
        ...(credential.kind === 'device'
          ? { deviceId: credential.deviceId }
          : { enrollId: credential.enrollId }),
      }
      socket.send(JSON.stringify(hello satisfies WireFrame))
    } catch (cause) {
      this.rejectHandshake(cause)
      socket.close(4001, 'handshake failed')
    }
  }

  /**
   * Separate a dead relay grant from a relay that is merely unreachable. The
   * health probe runs off the socket close, so a caller waiting on the rejected
   * handshake is not held open by it.
   */
  private classifyRefusedUpgrade(attempt: number, reason: string): void {
    this.setState('reconnecting', reason)
    void (async () => {
      const reachable = await relayReachable(this.config.wsUrl)
      if (this.closed || this.terminal || this.attemptSeq !== attempt) return
      if (!reachable) {
        this.setState('reconnecting', reason)
        this.scheduleReconnect()
        return
      }
      this.terminal = RELAY_GRANT_REJECTED_MESSAGE
      this.failEnrollment(new Error(this.terminal))
      this.setState('closed', this.terminal)
    })()
  }

  private async handleFrame(raw: unknown, socket: WebSocket): Promise<void> {
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

    if (isErrorFrame(parsed)) {
      if (parsed.sid !== this.sid) return
      this.handleErrorFrame(parsed.code, parsed.message)
      return
    }

    if (isHubHelloFrameV4(parsed)) {
      if (this.keys) return
      if (parsed.sid !== this.sid || !this.clientNonce || !this.clientEphemeral) return
      const credential = this.config.credential
      const input = {
        staticKey: credential.kind === 'device' ? credential.key : credential.enrollToken,
        sid: parsed.sid,
        nonceC: this.clientNonce,
        nonceS: parsed.nonce,
        ephC: this.clientEphemeral.publicKey,
        ephS: parsed.eph,
        privateKey: this.clientEphemeral.privateKey,
        peerPublicKey: parsed.eph,
      }
      try {
        // Verify the hub's proof before adopting any key. A bad MAC means this
        // socket is not talking to a hub that holds the static key; never fall
        // back to a nonce-only session.
        if (!(await verifyV4HelloMac({ ...input, mac: parsed.mac }))) {
          this.rejectHandshake(new Error('The home server could not prove the E2EE session key'))
          this.socket?.close(4001, 'handshake failed')
          return
        }
        const material = await deriveV4SessionKeys(input)
        if (this.socket !== socket) return
        this.keys = material.keys
        this.receive = new ReplayGuard()
        // The ephemeral private key is only needed for this handshake. Drop it
        // as soon as the session keys exist so forward secrecy does not depend
        // on the socket close path.
        this.clientEphemeral = null
      } catch (cause) {
        this.rejectHandshake(cause)
        this.socket?.close(4001, 'handshake failed')
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

    if (payload.type === 'device.enrolled') {
      const pending = this.enrollment
      this.enrollment = null
      if (pending) {
        window.clearTimeout(pending.timer)
        pending.resolve({
          deviceId: payload.deviceId,
          fingerprint: payload.fingerprint,
          label: payload.label,
          ...(payload.relayGrant ? { relayGrant: payload.relayGrant } : {}),
        })
      }
      return
    }

    if (payload.type === 'ready') {
      if (this.socket !== socket) return
      if (payload.relayGrant) {
        try {
          this.config.onRelayGrant?.(payload.relayGrant)
        } catch {
          // Persisting a refreshed grant must not break the session.
        }
      }
      this.statusValue = { ...this.statusValue, agent: payload.agent }
      this.retry = 0
      this.deadCode = null
      this.deadCount = 0
      this.setState('open', null)
      if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      void this.send({
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      }).catch(() => {})
      this.resolveHandshake()
      this.startHeartbeat()
      this.scheduleFrameRecovery()
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

  /**
   * The hub broadcasts error frames to every socket, so this only runs for a
   * frame addressed to the current session. Transient codes always reconnect.
   * A credential-dead code stops only when it repeats because a hub restart or
   * a stale broadcast must not strand the tab.
   */
  private handleErrorFrame(code: DeviceErrorCode, message: string): void {
    const cause = new Error(message)
    this.failEnrollment(cause)

    if (isCredentialDeadCode(code)) {
      this.deadCount = code === this.deadCode ? this.deadCount + 1 : 1
      this.deadCode = code
      if (this.deadCount >= CREDENTIAL_DEAD_LIMIT) {
        this.terminal = CREDENTIAL_DEAD_MESSAGES[code]
        this.rejectHandshake(new Error(this.terminal))
        this.setState('closed', this.terminal)
        this.socket?.close(4001, code)
        return
      }
    } else {
      this.clearTerminalError()
    }

    this.rejectHandshake(cause)
    this.socket?.close(4001, closeReason(message))
  }

  private clearTerminalError(): void {
    this.terminal = null
    this.deadCode = null
    this.deadCount = 0
  }

  private handleState(state: Exclude<ClaraState, { type: 'push.status' }>): void {
    if (state.type === 'device.enrolled') return
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
      const entry: QueuedRequest = {
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
      const onAbort = () => {
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        reject(abortError())
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

  private failEnrollment(cause: unknown): void {
    const pending = this.enrollment
    if (!pending) return
    this.enrollment = null
    window.clearTimeout(pending.timer)
    pending.reject(cause)
  }

  private failAllSync(cause: unknown): void {
    for (const id of [...this.syncPending.keys()]) this.failSyncPending(id, cause)
  }

  private send(payload: ClaraAction | ClaraState): Promise<void> {
    const run = this.sendChain.then(async () => {
      await this.paceFrame()
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

  /**
   * Wait for one frame of the room's per-device budget. A query burst is
   * spread out on the client so the room never has to refuse a frame: a
   * refusal closes the socket and drops every request still in flight.
   */
  private paceFrame(): Promise<void> {
    if (!this.metered || this.closed) return Promise.resolve()
    this.refillFrames(Date.now())
    if (this.frameTokens >= 1) {
      this.frameTokens -= 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.frameWaiters.push(resolve)
      this.pumpFrames()
    })
  }

  private refillFrames(now: number): void {
    if (this.frameRefilledAt === 0) {
      this.frameRefilledAt = now
      return
    }
    const elapsed = now - this.frameRefilledAt
    if (elapsed <= 0) return
    this.frameRefilledAt = now
    this.frameTokens = Math.min(
      RELAY_FRAME_BURST,
      this.frameTokens + (elapsed / 1000) * this.frameRate
    )
  }

  private pumpFrames(): void {
    if (this.frameTimer !== null || this.closed) return
    const wait = this.frameTokens >= 1 ? 0 : ((1 - this.frameTokens) / this.frameRate) * 1000
    this.frameTimer = window.setTimeout(() => {
      this.frameTimer = null
      this.refillFrames(Date.now())
      while (this.frameTokens >= 1 && this.frameWaiters.length > 0) {
        this.frameTokens -= 1
        this.frameWaiters.shift()?.()
      }
      if (this.frameWaiters.length > 0) this.pumpFrames()
    }, Math.max(0, Math.ceil(wait)))
  }

  /**
   * A closed socket cannot carry the frames still waiting, so settle them: each
   * send sees the missing socket and fails instead of holding a caller open.
   */
  private releaseFrameWaiters(): void {
    if (this.frameTimer !== null) window.clearTimeout(this.frameTimer)
    this.frameTimer = null
    for (const resolve of this.frameWaiters.splice(0)) resolve()
  }

  /**
   * The room refused this connection for volume. Dial again after a pause long
   * enough for its bucket to refill, and halve the local rate so a second tab or
   * a heavier screen converges instead of tripping the same limit forever.
   */
  private throttled(): void {
    this.frameRate = Math.max(MIN_FRAME_RATE, Math.floor(this.frameRate / 2))
    this.frameTokens = 0
    this.frameRefilledAt = Date.now()
    this.setState('reconnecting', `${THROTTLE_MESSAGE}. Retrying shortly.`)
    this.scheduleReconnect(THROTTLE_RECONNECT_MS)
  }

  private scheduleReconnect(minimumDelay = 0): void {
    if (this.closed || this.terminal || this.reconnectTimer !== null) return
    const base = Math.min(1_000 * 2 ** Math.min(this.retry, 5), MAX_RECONNECT_MS)
    const delay = Math.max(Math.round(base * (0.8 + Math.random() * 0.4)), minimumDelay)
    this.retry += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.closed) return
      this.handshake = null
      void this.ensureReady().catch(() => {})
    }, delay)
  }

  /** One stable connection lets a throttled rate climb back to the budget. */
  private scheduleFrameRecovery(): void {
    if (this.frameRate >= RELAY_FRAME_RATE) return
    if (this.frameRecoverTimer !== null) window.clearTimeout(this.frameRecoverTimer)
    this.frameRecoverTimer = window.setTimeout(() => {
      this.frameRecoverTimer = null
      this.frameRate = RELAY_FRAME_RATE
    }, THROTTLE_STABLE_MS)
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
    if (this.frameRecoverTimer !== null) window.clearTimeout(this.frameRecoverTimer)
    this.handshakeTimer = null
    this.reconnectTimer = null
    this.frameRecoverTimer = null
    this.releaseFrameWaiters()
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

function isCredentialDeadCode(code: DeviceErrorCode): code is CredentialDeadCode {
  return (CREDENTIAL_DEAD_CODES as readonly DeviceErrorCode[]).includes(code)
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
