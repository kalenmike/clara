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
import { clearStoredConnection, loadStoredConnection, saveStoredConnection } from '@/lib/storage'

type ConnectionContextValue = {
  config: ConnectionConfig | null
  client: OpenCodeClient | null
  info: ServerInfo | null
  status: ConnectionStatus
  error: string | null
  attempt: ConnectionConfig | null
  localInfo: ServerInfo | null
  connect: (config: ConnectionConfig) => Promise<boolean>
  connectLocal: () => Promise<boolean>
  disconnect: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConnectionConfig | null>(null)
  const [client, setClient] = useState<OpenCodeClient | null>(null)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<ConnectionConfig | null>(() => loadStoredConnection())
  const [localInfo, setLocalInfo] = useState<ServerInfo | null>(null)
  const booted = useRef(false)

  const connect = useCallback(async (next: ConnectionConfig) => {
    setStatus('connecting')
    setError(null)
    setAttempt(next)

    try {
      const nextClient = createClient(next)
      const nextInfo = await nextClient.server.info()
      setClient(nextClient)
      setConfig(next)
      setInfo(nextInfo)
      setStatus('connected')
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
  }, [])

  const connectLocal = useCallback(async () => {
    return connect(localProxyConfig())
  }, [connect])

  const disconnect = useCallback(() => {
    clearStoredConnection()
    setClient(null)
    setConfig(null)
    setInfo(null)
    setStatus('disconnected')
    setError(null)
    setAttempt(null)
  }, [])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    let cancelled = false

    const boot = async () => {
      const local = await detectLocalService()
      if (cancelled) return
      setLocalInfo(local)

      const stored = loadStoredConnection()
      if (stored) {
        await connect(stored)
        return
      }
      if (local) {
        await connect(localProxyConfig())
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
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
      connect,
      connectLocal,
      disconnect,
    }),
    [config, client, info, status, error, attempt, localInfo, connect, connectLocal, disconnect]
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection() {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used inside ConnectionProvider')
  return value
}
