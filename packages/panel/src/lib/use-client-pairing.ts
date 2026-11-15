import { useEffect, useRef, useState } from 'react'
import type {
  PanelDevicePairing,
  PanelDevicePairingMutationResponse,
  PanelSnapshot,
} from '@clara/shared-types'
import { findBrowserPairingConnection, type BrowserPairingConnection } from './browser-pairing.ts'
import {
  canStartPairing,
  pairingNotice,
  resolvePairingTransport,
  type PairingTransport,
} from './client-pairing.ts'
import { findFeature } from './feature-control.ts'
import { deletePanel, postPanel } from './panel-api.ts'

const DEFAULT_TRANSPORTS: PairingTransport[] = ['relay', 'local']
type PairingPending = 'create' | 'close'

export type ClientPairingFlow = {
  pairing?: PanelDevicePairing
  connection?: BrowserPairingConnection
  expired: boolean
  transport: PairingTransport
  relayUsable: boolean
  localAvailable: boolean
  canPair: boolean
  helper: string
  notice?: string
  pending?: PairingPending
  error?: string
  setTransport: (transport: PairingTransport) => void
  reportError: (message: string) => void
  create: () => Promise<void>
  close: () => Promise<void>
  startOver: () => Promise<void>
}

export function useClientPairing({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
  initialTransport,
  allowedTransports,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose?: () => void
  initialTransport?: PairingTransport
  allowedTransports?: PairingTransport[]
}): ClientPairingFlow {
  const allowed = allowedTransports ?? DEFAULT_TRANSPORTS
  const relayConfigured = snapshot.relay.configured
  const localAvailable = findFeature(snapshot.controls, 'local').effective
  const relayUsable = relayConfigured && findFeature(snapshot.controls, 'relay').effective
  const transportState = {
    allowed,
    initial: initialTransport,
    relayUsable,
    localUsable: localAvailable,
    stopped: snapshot.controls.stopped,
  }
  const canPair = canStartPairing(transportState)
  const notice = pairingNotice(transportState)
  const [transport, setTransport] = useState<PairingTransport>(() =>
    resolvePairingTransport(transportState)
  )
  const [pairing, setPairing] = useState<PanelDevicePairing>()
  const [issuedAt, setIssuedAt] = useState(0)
  const [connection, setConnection] = useState<BrowserPairingConnection>()
  const [pending, setPending] = useState<PairingPending>()
  const [error, setError] = useState<string>()
  const pendingPairingRef = useRef<string | undefined>(undefined)

  const useLocalOnly = relayConfigured && localAvailable && transport === 'local'
  const helper = relayConfigured
    ? transport === 'relay'
      ? 'A relay code works from a phone or another network.'
      : 'A local code only works on this machine or its network.'
    : 'No relay is configured, so a local code only works on this machine or its network.'
  const expiresAt = pairing ? Date.parse(pairing.expiresAt) : Number.NaN
  const expired =
    pairing !== undefined &&
    connection === undefined &&
    Number.isFinite(expiresAt) &&
    expiresAt <= now

  useEffect(() => {
    if (!open) return
    setPairing(undefined)
    setIssuedAt(0)
    setConnection(undefined)
    setPending(undefined)
    setError(undefined)
  }, [open])

  useEffect(() => {
    const next = resolvePairingTransport({
      allowed,
      initial: transport,
      relayUsable,
      localUsable: localAvailable,
      stopped: snapshot.controls.stopped,
    })
    if (next !== transport) setTransport(next)
  }, [allowed, localAvailable, relayUsable, snapshot.controls.stopped, transport])

  useEffect(() => {
    pendingPairingRef.current = pairing && !connection ? pairing.id : undefined
  }, [connection, pairing])

  useEffect(
    () => () => {
      const id = pendingPairingRef.current
      if (!id) return
      void deletePanel(`/panel/api/v1/devices/pairings/${encodeURIComponent(id)}`).catch(
        () => undefined
      )
    },
    []
  )

  useEffect(() => {
    if (!pairing || connection) return
    const found = findBrowserPairingConnection(issuedAt, pairing.transport, snapshot)
    if (!found) return
    setConnection(found)
    onChanged()
  }, [connection, issuedAt, onChanged, pairing, snapshot])

  const reset = () => {
    setPairing(undefined)
    setIssuedAt(0)
    setConnection(undefined)
    setPending(undefined)
    setError(undefined)
  }

  const create = async () => {
    setPending('create')
    setError(undefined)
    const issued = Date.now()
    try {
      const result = await postPanel<PanelDevicePairingMutationResponse>(
        '/panel/api/v1/devices/pairings',
        { localOnly: useLocalOnly }
      )
      setIssuedAt(issued)
      setPairing(result.pairing)
      setConnection(undefined)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const dispose = async (): Promise<boolean> => {
    if (!pairing) return true
    setPending('close')
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/devices/pairings/${encodeURIComponent(pairing.id)}`)
      onChanged()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPending(undefined)
      return false
    }
  }

  const close = async () => {
    if (pending) return
    if (pairing && !connection && !(await dispose())) return
    reset()
    onClose?.()
  }

  const startOver = async () => {
    if (pending) return
    if (!(await dispose())) return
    reset()
  }

  return {
    ...(pairing ? { pairing } : {}),
    ...(connection ? { connection } : {}),
    expired,
    transport,
    relayUsable,
    localAvailable,
    canPair,
    helper,
    ...(notice ? { notice } : {}),
    ...(pending ? { pending } : {}),
    ...(error ? { error } : {}),
    setTransport,
    reportError: setError,
    create,
    close,
    startOver,
  }
}
