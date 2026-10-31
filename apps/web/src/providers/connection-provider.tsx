/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  connectionKey,
  createClient,
  describeConnectionError,
  detectLocalService,
  isRelayConfig,
  localProxyConfig,
  resolveRelayWsUrl,
  type ClientControl,
  type ClientHandle,
  type ConnectionConfig,
  type ConnectionStatus,
  type OpenCodeClient,
  type ServerInfo,
} from '@/lib/client'
import type { RelayTransportStatus } from '@/lib/transport/relay'
import { chatStore } from '@/features/chat/chat-store'
import { takePairingLink } from '@/lib/pairing'
import { clearStoredConnection, loadStoredConnection, saveStoredConnection } from '@/lib/storage'

const PROBE_TIMEOUT_MS = 8_000
const RECONNECT_TIMEOUT_MS = 5_000

type ConnectionContextValue = {
  config: ConnectionConfig | null
  client: OpenCodeClient | null
  info: ServerInfo | null
  status: ConnectionStatus
  error: string | null
  attempt: ConnectionConfig | null
  localInfo: ServerInfo | null
  relayStatus: RelayTransportStatus | null
  /** Bumped when a new client is installed so the stream resubscribes. */
  generation: number
  control: ClientControl | null
  reconnecting: boolean
  reconnectError: string | null
  connect: (config: ConnectionConfig) => Promise<boolean>
  connectLocal: () => Promise<boolean>
  reconnect: () => Promise<boolean>
  disconnect: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

/** Survives React StrictMode's development remount, unlike a ref. */
let bootStarted = false

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<ConnectionConfig | null>(null)
  const [client, setClient] = useState<OpenCodeClient | null>(null)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<ConnectionConfig | null>(() => loadStoredConnection())
  const [localInfo, setLocalInfo] = useState<ServerInfo | null>(null)
  const [relayStatus, setRelayStatus] = useState<RelayTransportStatus | null>(null)
  const [control, setControl] = useState<ClientControl | null>(null)
  const [generation, setGeneration] = useState(0)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const configRef = useRef<ConnectionConfig | null>(null)
  const handleRef = useRef<ClientHandle | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const booted = useRef(false)

  const clearHandle = useCallback(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    handleRef.current?.close()
    handleRef.current = null
    setRelayStatus(null)
    setControl(null)
  }, [])

  const installHandle = useCallback((handle: ClientHandle) => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    handleRef.current?.close()
    handleRef.current = handle
    setControl(handle.control ?? null)
    if (handle.subscribeStatus) {
      unsubscribeRef.current = handle.subscribeStatus(setRelayStatus)
    } else {
      setRelayStatus(null)
    }
  }, [])

  const connect = useCallback(
    async (next: ConnectionConfig) => {
      setStatus('connecting')
      setError(null)
      setAttempt(next)

      const handle = createClient(next)
      try {
        const nextInfo = await handle.client.server.info({
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        if (connectionKey(configRef.current ?? next) !== connectionKey(next)) {
          chatStore.reset()
          queryClient.clear()
        }
        configRef.current = next
        installHandle(handle)
        setClient(handle.client)
        setConfig(next)
        setInfo(nextInfo)
        setStatus('connected')
        setGeneration((value) => value + 1)
        saveStoredConnection(next)
        return true
      } catch (cause) {
        handle.close()
        clearHandle()
        setClient(null)
        setConfig(null)
        setInfo(null)
        setStatus('error')
        setError(describeConnectionError(cause))
        return false
      }
    },
    [clearHandle, installHandle, queryClient]
  )

  const connectLocal = useCallback(async () => {
    return connect(localProxyConfig())
  }, [connect])

  /**
   * Re-prove an existing connection without leaving the app or losing the
   * stored credentials. A failure keeps the current client alive because the
   * stream may still recover on its own.
   */
  const reconnect = useCallback(async () => {
    const current = configRef.current
    if (!current) return false

    setReconnecting(true)
    setReconnectError(null)

    const handle = createClient(current)
    try {
      const nextInfo = await handle.client.server.info({
        signal: AbortSignal.timeout(RECONNECT_TIMEOUT_MS),
      })
      installHandle(handle)
      setClient(handle.client)
      setInfo(nextInfo)
      setStatus('connected')
      setError(null)
      setGeneration((value) => value + 1)
      void queryClient.invalidateQueries()
      return true
    } catch (cause) {
      handle.close()
      setReconnectError(describeConnectionError(cause))
      return false
    } finally {
      setReconnecting(false)
    }
  }, [installHandle, queryClient])

  const disconnect = useCallback(() => {
    clearStoredConnection()
    configRef.current = null
    clearHandle()
    chatStore.reset()
    queryClient.clear()
    setClient(null)
    setConfig(null)
    setInfo(null)
    setStatus('disconnected')
    setError(null)
    setAttempt(null)
    setReconnectError(null)
    setGeneration((value) => value + 1)
  }, [clearHandle, queryClient])

  useEffect(() => {
    if (booted.current || bootStarted) return
    booted.current = true
    bootStarted = true

    const boot = async () => {
      // A pairing link owns the first connection attempt, even when React
      // Router has already rewritten the URL to `/connect`.
      const pairing = takePairingLink()
      if (pairing) {
        await connect({
          mode: 'relay',
          ...pairing,
          wsUrl: resolveRelayWsUrl(pairing.wsUrl, pairing.room),
          remember: true,
          label: 'Clara server',
        })
        return
      }

      const stored = loadStoredConnection()
      if (stored) {
        // Re-resolve the stored endpoint so a deployment switch change applies
        // to devices paired before it was set. Local pairings keep their URL.
        const config = isRelayConfig(stored)
          ? { ...stored, wsUrl: resolveRelayWsUrl(stored.wsUrl, stored.room) }
          : stored
        // Do not make the stored connection wait for the local-service probe.
        if (!isRelayConfig(config)) void detectLocalService().then(setLocalInfo)
        await connect(config)
        return
      }

      const local = await detectLocalService()
      setLocalInfo(local)
      if (local) await connect(localProxyConfig())
    }

    void boot()
    // Boot once; connect is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<ConnectionContextValue>(
    () => ({
      config,
      client,
      info,
      status,
      error,
      attempt,
      localInfo,
      relayStatus,
      generation,
      control,
      reconnecting,
      reconnectError,
      connect,
      connectLocal,
      reconnect,
      disconnect,
    }),
    [
      config,
      client,
      info,
      status,
      error,
      attempt,
      localInfo,
      relayStatus,
      generation,
      control,
      reconnecting,
      reconnectError,
      connect,
      connectLocal,
      reconnect,
      disconnect,
    ]
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection() {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used inside ConnectionProvider')
  return value
}
