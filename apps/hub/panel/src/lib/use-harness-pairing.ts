import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AdapterInstallOffer,
  PanelHarness,
  PanelInstallInfo,
  PanelSnapshot,
} from '@clara/shared-types'
import { HARNESS_KINDS, findHarnessPairingConnection } from './harness-pairing.ts'
import { createAdapterOffer, fetchInstallInfo } from './install.ts'
import { deletePanel } from './panel-api.ts'

type HarnessPairingPending = 'create' | 'close'

export type HarnessPairingFlow = {
  kind: string
  pairing?: AdapterInstallOffer['pairing']
  offer?: AdapterInstallOffer
  connection?: PanelHarness
  expired: boolean
  step: 1 | 2
  info?: PanelInstallInfo
  infoLoading: boolean
  infoError?: string
  installEnabled: boolean
  installAvailable: boolean
  canContinue: boolean
  notice?: string
  opencodeUrl: string
  pending?: HarnessPairingPending
  error?: string
  setKind: (kind: string) => void
  setOpencodeUrl: (value: string) => void
  refreshInfo: () => Promise<void>
  begin: () => Promise<void>
  close: () => Promise<void>
  startOver: () => Promise<void>
  reportError: (message: string) => void
}

/**
 * Drives the harness pairing modal. The hub issues a one-time code and the
 * install command; the person runs the command, or the desktop client opens it
 * from the code link. Nothing is executed on the hub host.
 */
export function useHarnessPairing({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose?: () => void
}): HarnessPairingFlow {
  const installEnabled = snapshot.controls.install.enabled
  const [kind, setKind] = useState<string>(HARNESS_KINDS[0].kind)
  const [offer, setOffer] = useState<AdapterInstallOffer>()
  const [connection, setConnection] = useState<PanelHarness>()
  const [pending, setPending] = useState<HarnessPairingPending>()
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<PanelInstallInfo>()
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState<string>()
  const [opencodeUrl, setOpencodeUrl] = useState('')

  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  const loadingRef = useRef(false)
  const loadInfo = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setInfoLoading(true)
    setInfoError(undefined)
    try {
      setInfo(await fetchInstallInfo())
    } catch (cause) {
      setInfoError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      loadingRef.current = false
      setInfoLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadInfo()
  }, [loadInfo, open])

  const reset = useCallback(() => {
    setOffer(undefined)
    setConnection(undefined)
    setPending(undefined)
    setError(undefined)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const pairing = offer?.pairing
  const step: 1 | 2 = pairing ? 2 : 1
  const installAvailable = installEnabled && info?.available === true
  const canContinue = !snapshot.controls.stopped && installAvailable
  const notice = snapshot.controls.stopped
    ? 'External connections are off. Turn them on from Overview before pairing an adapter.'
    : !installEnabled
      ? 'Adapter setup is off. Turn it on in Settings → Adapter downloads.'
      : info && !info.available
        ? info.reason
        : undefined

  const expiresAt = pairing ? Date.parse(pairing.expiresAt) : Number.NaN
  const expired =
    pairing !== undefined &&
    connection === undefined &&
    Number.isFinite(expiresAt) &&
    expiresAt <= now

  useEffect(() => {
    if (!pairing || connection) return
    const found = findHarnessPairingConnection(pairing, snapshot.harnesses)
    if (!found) return
    setConnection(found)
    onChangedRef.current()
  }, [connection, pairing, snapshot.harnesses])

  const begin = async () => {
    if (pending || !canContinue) return
    setPending('create')
    setError(undefined)
    try {
      const next = await createAdapterOffer({
        kind,
        ...(kind === 'opencode' && opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
      })
      setOffer(next)
      setConnection(undefined)
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const dispose = async (): Promise<boolean> => {
    if (!pairing || connection) return true
    setPending('close')
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/harnesses/pairings/${encodeURIComponent(pairing.id)}`)
      onChangedRef.current()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPending(undefined)
      return false
    }
  }

  const close = async () => {
    if (pending) return
    if (!(await dispose())) return
    reset()
    onClose?.()
  }

  const startOver = async () => {
    if (pending) return
    if (!(await dispose())) return
    reset()
  }

  return {
    kind,
    ...(pairing ? { pairing } : {}),
    ...(offer ? { offer } : {}),
    ...(connection ? { connection } : {}),
    expired,
    step,
    ...(info ? { info } : {}),
    infoLoading,
    ...(infoError ? { infoError } : {}),
    installEnabled,
    installAvailable,
    canContinue,
    ...(notice ? { notice } : {}),
    opencodeUrl,
    ...(pending ? { pending } : {}),
    ...(error ? { error } : {}),
    setKind,
    setOpencodeUrl,
    refreshInfo: loadInfo,
    begin,
    close,
    startOver,
    reportError: setError,
  }
}
