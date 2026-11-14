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
import type { PairingPayload } from '@clara/shared-types'
import {
  connectionKey,
  connectionSummary,
  createClient,
  describeConnectionError,
  resolveRelayWsUrl,
  type ClientControl,
  type ClientHandle,
  type ConnectionStatus,
  type ConnectionSummary,
  type DeviceConnection,
  type ClaraClient,
  type HarnessInfo,
  type HubInfo,
} from '@/lib/client'
import type { RelayTransportStatus } from '@/lib/transport/relay'
import { chatStore } from '@/features/chat/chat-store'
import { probeHub } from '@/lib/hub-probe'
import { hasPendingPairingLink, takePairingLink } from '@/lib/pairing'
import { desktopLocalWsUrl } from '@/lib/desktop-runtime'
import {
  canStoreDeviceKey,
  clearDevice,
  loadDevice,
  saveDevice,
  type StoredDevice,
} from '@/lib/device-store'

const PROBE_TIMEOUT_MS = 8_000
const RECONNECT_TIMEOUT_MS = 5_000
/**
 * The connect screen holds its boot splash until the first attempt settles.
 * Every normal path has a shorter timeout; this only guards a wedged handshake.
 */
const BOOT_TIMEOUT_MS = 12_000

export type ConnectionBootSource = 'pairing-link' | 'stored' | null

type ConnectionContextValue = {
  config: ConnectionSummary | null
  client: ClaraClient | null
  hub: HubInfo | null
  harness: HarnessInfo | null
  harnessError: string | null
  status: ConnectionStatus
  error: string | null
  attempt: ConnectionSummary | null
  /** True until the initial stored/link attempt has settled. */
  booting: boolean
  bootSource: ConnectionBootSource
  relayStatus: RelayTransportStatus | null
  /** Bumped when a new client is installed so the stream resubscribes. */
  generation: number
  control: ClientControl | null
  reconnecting: boolean
  reconnectError: string | null
  connect: (payload: PairingPayload) => Promise<boolean>
  reconnect: () => Promise<boolean>
  refreshHarness: () => Promise<void>
  disconnect: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

/** Survives React StrictMode's development remount, unlike a ref. */
let bootStarted = false

/**
 * A local hub can come back on a different port after a conflict. The device
 * key is independent of the port, so refresh the endpoint and reconnect rather
 * than making the user pair again.
 */
async function refreshLocalDevice(device: StoredDevice): Promise<StoredDevice> {
  if (device.room !== 'local') return device
  const wsUrl = await desktopLocalWsUrl()
  if (!wsUrl || wsUrl === device.wsUrl) return device
  const next = { ...device, wsUrl }
  await saveDevice(next)
  return next
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<ConnectionSummary | null>(null)
  const [client, setClient] = useState<ClaraClient | null>(null)
  const [hub, setHub] = useState<HubInfo | null>(null)
  const [harness, setHarness] = useState<HarnessInfo | null>(null)
  const [harnessError, setHarnessError] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<ConnectionSummary | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootSource, setBootSource] = useState<ConnectionBootSource>(() =>
    hasPendingPairingLink() ? 'pairing-link' : null
  )
  const [relayStatus, setRelayStatus] = useState<RelayTransportStatus | null>(null)
  const [control, setControl] = useState<ClientControl | null>(null)
  const [generation, setGeneration] = useState(0)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const configRef = useRef<DeviceConnection | null>(null)
  const handleRef = useRef<ClientHandle | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const harnessRequestRef = useRef(0)
  const harnessFailedRef = useRef(false)
  const booted = useRef(false)

  const clearHarness = useCallback(() => {
    harnessRequestRef.current += 1
    harnessFailedRef.current = false
    setHarness(null)
    setHarnessError(null)
  }, [])

  const refreshHarness = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    const request = (harnessRequestRef.current += 1)
    try {
      const next = await handle.client.server.info({
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (harnessRequestRef.current !== request) return
      const recovered = harnessFailedRef.current
      harnessFailedRef.current = false
      setHarness(next)
      setHarnessError(null)
      if (recovered) void queryClient.invalidateQueries()
    } catch (cause) {
      if (harnessRequestRef.current !== request) return
      harnessFailedRef.current = true
      setHarness(null)
      setHarnessError(describeConnectionError(cause))
    }
  }, [queryClient])

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
    setControl(handle.control)
    unsubscribeRef.current = handle.subscribeStatus(setRelayStatus)
  }, [])

  // Harness liveness is a separate concern from the hub tunnel. A failed
  // `/v1/harness/info` leaves the connection up and surfaces a banner instead.
  useEffect(() => {
    if (!client) {
      clearHarness()
      return
    }
    void refreshHarness()
  }, [client, clearHarness, refreshHarness])

  const connectDevice = useCallback(
    async (device: StoredDevice): Promise<boolean> => {
      const next: DeviceConnection = {
        kind: 'device',
        wsUrl: resolveRelayWsUrl(device.wsUrl, device.room),
        room: device.room,
        clientToken: device.clientToken,
        deviceId: device.deviceId,
        key: device.key,
        fingerprint: device.fingerprint,
        label: device.label,
      }
      const summary = connectionSummary(next)
      setStatus('connecting')
      setError(null)
      setAttempt(summary)

      const handle = createClient(next)
      try {
        const nextHub = await probeHub(handle.client, PROBE_TIMEOUT_MS)
        if (configRef.current && connectionKey(configRef.current) !== connectionKey(summary)) {
          chatStore.reset()
          queryClient.clear()
        }
        configRef.current = next
        installHandle(handle)
        setClient(handle.client)
        setConfig(summary)
        setHub(nextHub)
        setStatus('connected')
        setGeneration((value) => value + 1)
        return true
      } catch (cause) {
        handle.close()
        clearHandle()
        setClient(null)
        setConfig(null)
        setHub(null)
        clearHarness()
        setStatus('error')
        setError(describeConnectionError(cause))
        return false
      }
    },
    [clearHandle, clearHarness, installHandle, queryClient]
  )

  const connectPairing = useCallback(
    async (payload: PairingPayload): Promise<boolean> => {
      const wsUrl = resolveRelayWsUrl(payload.wsUrl, payload.room)
      setStatus('connecting')
      setError(null)
      setAttempt({ wsUrl, room: payload.room, label: 'Clara hub' })

      if (Date.now() > payload.expiresAt) {
        setStatus('error')
        setError('This pairing code has expired. Generate a new one on the hub.')
        return false
      }
      if (!(await canStoreDeviceKey())) {
        setStatus('error')
        setError(
          'This browser cannot store a protected device key. Update the browser or use a different one.'
        )
        return false
      }

      const label = deviceLabel()
      const handle = createClient({
        kind: 'enroll',
        wsUrl,
        room: payload.room,
        clientToken: payload.clientToken,
        enrollId: payload.enrollId,
        enrollToken: payload.enrollToken,
        expiresAt: payload.expiresAt,
        label,
      })
      try {
        const enrolled = await handle.enroll(label)
        const stored: StoredDevice = {
          deviceId: enrolled.deviceId,
          label: enrolled.label,
          wsUrl,
          room: payload.room,
          clientToken: payload.clientToken,
          fingerprint: enrolled.fingerprint,
          key: enrolled.key,
          createdAt: Date.now(),
        }
        await saveDevice(stored)
        handle.close()
        return await connectDevice(stored)
      } catch (cause) {
        handle.close()
        clearHandle()
        setClient(null)
        setConfig(null)
        setHub(null)
        clearHarness()
        setStatus('error')
        setError(describeConnectionError(cause))
        return false
      }
    },
    [clearHandle, clearHarness, connectDevice]
  )

  const connect = useCallback(
    (payload: PairingPayload) => connectPairing(payload),
    [connectPairing]
  )

  /**
   * Re-prove an existing connection without leaving the app or losing the
   * stored credential. A failure keeps the current client alive because the
   * stream may still recover on its own.
   */
  const reconnect = useCallback(async () => {
    let current = configRef.current
    if (!current) return false

    if (current.room === 'local') {
      const wsUrl = await desktopLocalWsUrl()
      if (wsUrl && wsUrl !== current.wsUrl) {
        const stored = await loadDevice()
        if (stored) await saveDevice({ ...stored, wsUrl })
        current = { ...current, wsUrl }
        configRef.current = current
      }
    }

    setReconnecting(true)
    setReconnectError(null)

    const handle = createClient(current)
    try {
      const nextHub = await probeHub(handle.client, RECONNECT_TIMEOUT_MS)
      installHandle(handle)
      setClient(handle.client)
      setConfig(connectionSummary(current))
      setHub(nextHub)
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
    void clearDevice()
    configRef.current = null
    clearHandle()
    chatStore.reset()
    queryClient.clear()
    setClient(null)
    setConfig(null)
    setHub(null)
    clearHarness()
    setStatus('disconnected')
    setError(null)
    setAttempt(null)
    setReconnectError(null)
    setGeneration((value) => value + 1)
  }, [clearHandle, clearHarness, queryClient])

  useEffect(() => {
    if (booted.current || bootStarted) return
    booted.current = true
    bootStarted = true

    const timeout = window.setTimeout(() => setBooting(false), BOOT_TIMEOUT_MS)

    const boot = async () => {
      try {
        // A pairing link owns the first connection attempt, even when React
        // Router has already rewritten the URL to `/connect`.
        const pairing = takePairingLink()
        if (pairing) {
          setBootSource('pairing-link')
          await connectPairing(pairing)
          return
        }

        const stored = await loadDevice()
        if (stored) {
          setBootSource('stored')
          // Re-resolve the stored endpoint so a deployment switch change or a
          // local port change applies to devices paired earlier.
          const current = await refreshLocalDevice(stored)
          await connectDevice({
            ...current,
            wsUrl: resolveRelayWsUrl(current.wsUrl, current.room),
          })
        }
      } finally {
        window.clearTimeout(timeout)
        setBooting(false)
      }
    }

    void boot()
    // Boot once; connect is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<ConnectionContextValue>(
    () => ({
      config,
      client,
      hub,
      harness,
      harnessError,
      status,
      error,
      attempt,
      booting,
      bootSource,
      relayStatus,
      generation,
      control,
      reconnecting,
      reconnectError,
      connect,
      reconnect,
      refreshHarness,
      disconnect,
    }),
    [
      config,
      client,
      hub,
      harness,
      harnessError,
      status,
      error,
      attempt,
      booting,
      bootSource,
      relayStatus,
      generation,
      control,
      reconnecting,
      reconnectError,
      connect,
      reconnect,
      refreshHarness,
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

function deviceLabel(): string {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS device'
  if (/Android/i.test(userAgent)) return 'Android device'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac'
  if (/Windows/i.test(userAgent)) return 'Windows device'
  if (/Linux/i.test(userAgent)) return 'Linux device'
  return 'Clara device'
}
