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
  createClient,
  describeConnectionError,
  detectLocalService,
  localProxyConfig,
  type ConnectionConfig,
  type ConnectionStatus,
  type OpenCodeClient,
  type ServerInfo,
} from '@/lib/client'
import { chatStore } from '@/features/chat/chat-store'
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
  /** Bumped when a new client is installed so the stream resubscribes. */
  generation: number
  reconnecting: boolean
  reconnectError: string | null
  connect: (config: ConnectionConfig) => Promise<boolean>
  connectLocal: () => Promise<boolean>
  reconnect: () => Promise<boolean>
  disconnect: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<ConnectionConfig | null>(null)
  const [client, setClient] = useState<OpenCodeClient | null>(null)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<ConnectionConfig | null>(() => loadStoredConnection())
  const [localInfo, setLocalInfo] = useState<ServerInfo | null>(null)
  const [generation, setGeneration] = useState(0)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const configRef = useRef<ConnectionConfig | null>(null)
  const booted = useRef(false)

  const connect = useCallback(
    async (next: ConnectionConfig) => {
      setStatus('connecting')
      setError(null)
      setAttempt(next)

      try {
        const nextClient = createClient(next)
        const nextInfo = await nextClient.server.info({
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        if (configRef.current?.baseUrl !== next.baseUrl) {
          chatStore.reset()
          queryClient.clear()
        }
        configRef.current = next
        setClient(nextClient)
        setConfig(next)
        setInfo(nextInfo)
        setStatus('connected')
        setGeneration((value) => value + 1)
        saveStoredConnection(next)
        return true
      } catch (cause) {
        setClient(null)
        setConfig(null)
        setInfo(null)
        setStatus('error')
        setError(describeConnectionError(cause))
        return false
      }
    },
    [queryClient]
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

    try {
      const nextClient = createClient(current)
      const nextInfo = await nextClient.server.info({
        signal: AbortSignal.timeout(RECONNECT_TIMEOUT_MS),
      })
      setClient(nextClient)
      setInfo(nextInfo)
      setStatus('connected')
      setError(null)
      setGeneration((value) => value + 1)
      void queryClient.invalidateQueries()
      return true
    } catch (cause) {
      setReconnectError(describeConnectionError(cause))
      return false
    } finally {
      setReconnecting(false)
    }
  }, [queryClient])

  const disconnect = useCallback(() => {
    clearStoredConnection()
    configRef.current = null
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
  }, [queryClient])

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    const boot = async () => {
      const stored = loadStoredConnection()
      if (stored) {
        // Do not make the stored connection wait for the local-service probe.
        void detectLocalService().then(setLocalInfo)
        await connect(stored)
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
      generation,
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
      generation,
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
