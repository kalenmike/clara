import { WebSocket } from 'ws'
import {
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  type WireFrame,
} from '@clara/shared-types'
import type { Agent } from './agent.ts'

const MAX_BACKOFF_MS = 30_000
const HEARTBEAT_MS = 20_000
const STALL_MS = 45_000

export type RelayStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export type RelayClientOptions = {
  url: string
  room: string
  agentToken: string
  agent: Agent
  log?: (message: string, detail?: unknown) => void
  onStatus?: (status: RelayStatus) => void
}

export class RelayClient {
  private socket: WebSocket | null = null
  private stopped = true
  private retry = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastPong = 0
  private readonly options: RelayClientOptions

  constructor(options: RelayClientOptions) {
    this.options = options
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.retry = 0
    this.connect()
  }

  send(frame: WireFrame): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(frame))
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.socket?.close(1000, 'server shutting down')
    this.socket = null
    this.options.agent.reset()
    this.options.onStatus?.('offline')
  }

  private connect(): void {
    if (this.stopped) return
    this.options.onStatus?.(this.retry === 0 ? 'connecting' : 'reconnecting')

    const url = relayUrl(this.options.url, this.options.room)
    const socket = new WebSocket(url, [
      RELAY_SUBPROTOCOL,
      `${RELAY_ROLE_PREFIX}agent`,
      `${RELAY_AUTH_PREFIX}${this.options.agentToken}`,
    ])
    this.socket = socket

    socket.on('open', () => {
      if (this.socket !== socket) return
      this.retry = 0
      this.lastPong = Date.now()
      this.options.agent.reset()
      this.options.log?.(`relay connected (${url})`)
      this.options.onStatus?.('online')
      this.startHeartbeat(socket)
    })

    socket.on('pong', () => {
      this.lastPong = Date.now()
    })

    socket.on('message', (data) => {
      this.lastPong = Date.now()
      this.options.agent.handleMessage(data.toString())
    })

    socket.on('unexpected-response', (_request, response) => {
      this.options.log?.(`relay rejected the connection (${response.statusCode})`)
    })

    socket.on('error', (cause) => {
      this.options.log?.('relay socket error', cause)
    })

    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopHeartbeat()
      this.options.agent.reset()
      this.options.log?.(`relay disconnected (${code} ${reason.toString() || 'no reason'})`)
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.options.onStatus?.('reconnecting')
    const base = Math.min(1_000 * 2 ** Math.min(this.retry, 5), MAX_BACKOFF_MS)
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
      if (Date.now() - this.lastPong > STALL_MS) {
        socket.terminate()
        return
      }
      socket.ping()
    }, HEARTBEAT_MS)
    this.heartbeatTimer.unref()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

function relayUrl(value: string, room: string): string {
  const url = new URL(value)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/room/${encodeURIComponent(room)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
