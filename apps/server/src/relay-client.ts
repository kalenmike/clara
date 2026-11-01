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

export type RelaySnapshot = {
  status: RelayStatus
  connectedSince?: number
  lastChangedAt: number
  reconnectAttempts: number
  lastError?: string
}

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
  private status: RelayStatus = 'offline'
  private statusChangedAt = Date.now()
  private connectedSince: number | undefined
  private lastError: string | undefined
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastPong = 0
  private readonly options: RelayClientOptions

  constructor(options: RelayClientOptions) {
    this.options = options
  }

  getSnapshot(): RelaySnapshot {
    return {
      status: this.status,
      ...(this.connectedSince !== undefined ? { connectedSince: this.connectedSince } : {}),
      lastChangedAt: this.statusChangedAt,
      reconnectAttempts: this.retry,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
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
    this.connectedSince = undefined
    this.setStatus('offline')
    this.options.agent.reset()
  }

  private connect(): void {
    if (this.stopped) return
    this.setStatus(this.retry === 0 ? 'connecting' : 'reconnecting')

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
      this.connectedSince = Date.now()
      this.lastError = undefined
      this.options.agent.reset()
      this.options.log?.(`relay connected (${url})`)
      this.setStatus('online')
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
      this.lastError = `Relay rejected the connection (${response.statusCode})`
      this.options.log?.(this.lastError)
    })

    socket.on('error', (cause) => {
      this.lastError = clip(errorMessage(cause), 240)
      this.options.log?.('relay socket error', cause)
    })

    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return
      this.socket = null
      this.connectedSince = undefined
      this.stopHeartbeat()
      this.options.agent.reset()
      this.options.log?.(`relay disconnected (${code} ${reason.toString() || 'no reason'})`)
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.setStatus('reconnecting')
    const base = Math.min(1_000 * 2 ** Math.min(this.retry, 5), MAX_BACKOFF_MS)
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.retry += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
    this.reconnectTimer.unref()
  }

  private setStatus(status: RelayStatus): void {
    if (this.status !== status) {
      this.status = status
      this.statusChangedAt = Date.now()
    }
    this.options.onStatus?.(status)
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
