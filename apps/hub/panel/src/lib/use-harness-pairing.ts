import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PanelHarness,
  PanelHarnessPairing,
  PanelHarnessPairingMutationResponse,
  PanelInstallDockerContainer,
  PanelInstallInfo,
  PanelInstallJob,
  PanelInstallStart,
  PanelSnapshot,
} from '@clara/shared-types'
import { findFeature } from './feature-control.ts'
import {
  HARNESS_KINDS,
  findHarnessPairingConnection,
  resolveHarnessTransport,
  type HarnessMachine,
  type HarnessTransportMode,
} from './harness-pairing.ts'
import { cancelInstallJob, fetchInstallInfo, fetchInstallJob, startInstall } from './install.ts'
import { deletePanel, postPanel } from './panel-api.ts'

/** The panel uses a sentinel because an SSH alias is a free-text select value. */
export const MANUAL_SSH_HOST = '__manual__'

type HarnessPairingPending = 'create' | 'install' | 'close'

export type HarnessPairingFlow = {
  machine: HarnessMachine
  kind: string
  pairing?: PanelHarnessPairing
  job?: PanelInstallJob
  connection?: PanelHarness
  expired: boolean
  step: 1 | 2
  info?: PanelInstallInfo
  infoLoading: boolean
  infoError?: string
  installEnabled: boolean
  installAvailable: boolean
  relayUsable: boolean
  localUsable: boolean
  canContinue: boolean
  notice?: string
  dockerRelayNotice?: string
  sshHosts: PanelInstallInfo['ssh']['hosts']
  containers: PanelInstallDockerContainer[]
  sshHost: string
  sshHostname: string
  sshUser: string
  sshPort: string
  container: string
  opencodeUrl: string
  wsUrl: string
  defaultWsUrl: string
  pending?: HarnessPairingPending
  error?: string
  setMachine: (machine: HarnessMachine) => void
  setKind: (kind: string) => void
  setSshHost: (host: string) => void
  setSshHostname: (value: string) => void
  setSshUser: (value: string) => void
  setSshPort: (value: string) => void
  setContainer: (value: string) => void
  setOpencodeUrl: (value: string) => void
  setWsUrl: (value: string) => void
  refreshInfo: () => Promise<void>
  begin: () => Promise<void>
  install: () => Promise<void>
  cancelInstall: () => Promise<void>
  close: () => Promise<void>
  startOver: () => Promise<void>
  reportError: (message: string) => void
}

/**
 * Drives the two-step harness pairing modal. The person answers where the
 * harness runs; the transport follows from that and from whether the hub
 * itself is containerized. Beginning the flow creates the copy-path code so
 * the copy buttons are usable immediately; starting an install replaces it
 * with the pairing that matches the install target.
 */
export function useHarnessPairing({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
  initialMachine,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose?: () => void
  initialMachine?: HarnessMachine
}): HarnessPairingFlow {
  const installEnabled = snapshot.controls.install.enabled
  const relayUsable = snapshot.relay.configured && findFeature(snapshot.controls, 'relay').effective
  const localUsable = findFeature(snapshot.controls, 'local').effective

  const [machine, setMachine] = useState<HarnessMachine>(initialMachine ?? 'local')
  const [kind, setKind] = useState<string>(HARNESS_KINDS[0].kind)
  const [pairing, setPairing] = useState<PanelHarnessPairing>()
  const [job, setJob] = useState<PanelInstallJob>()
  const [connection, setConnection] = useState<PanelHarness>()
  const [pending, setPending] = useState<HarnessPairingPending>()
  const [error, setError] = useState<string>()

  const [info, setInfo] = useState<PanelInstallInfo>()
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState<string>()

  const [sshHost, setSshHost] = useState('')
  const [sshHostname, setSshHostname] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [container, setContainer] = useState('')
  const [opencodeUrl, setOpencodeUrl] = useState('')
  const [wsUrl, setWsUrl] = useState('')

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
    setPairing(undefined)
    setJob(undefined)
    setConnection(undefined)
    setPending(undefined)
    setError(undefined)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const step: 1 | 2 = pairing ? 2 : 1
  const copyTransport: HarnessTransportMode = resolveHarnessTransport({
    machine,
    containerized: snapshot.agent.container,
  })
  const manualSsh = sshHost === MANUAL_SSH_HOST
  const hostReady = manualSsh ? sshHostname.trim().length > 0 : Boolean(sshHost)
  const targetReady = machine === 'remote' ? hostReady : container.length > 0
  const installReady =
    installEnabled &&
    info?.enabled !== false &&
    info?.available === true &&
    (machine === 'remote'
      ? info.ssh.available === true && hostReady
      : info.docker.available === true && targetReady)
  const containers = info?.docker.containers ?? []
  const sshHosts = info?.ssh.hosts ?? []
  const canContinue =
    !snapshot.controls.stopped && (machine === 'remote' ? relayUsable : localUsable)

  const notice = !canContinue
    ? snapshot.controls.stopped
      ? 'External connections are off. Turn them on from Overview before pairing an adapter.'
      : machine === 'remote'
        ? 'Relay pairing is unavailable. Configure or enable the relay from Network before installing on another machine.'
        : 'Local transport is off. Turn it on from Network before pairing a local adapter.'
    : undefined

  const dockerRelayNotice =
    machine === 'local' && installEnabled && !snapshot.agent.container && containers.length > 0
      ? 'This hub runs as a host process, so an adapter inside a container connects through the relay.'
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

  const jobId = job?.id
  const running = job?.state === 'running'
  useEffect(() => {
    if (!jobId || !running) return
    let active = true
    const timer = window.setInterval(() => {
      void fetchInstallJob(jobId)
        .then((next) => {
          if (!active) return
          setJob(next)
          if (next.state !== 'running') onChangedRef.current()
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        })
    }, 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [jobId, running])

  const begin = async () => {
    if (pending || !canContinue) return
    const override = wsUrl.trim()
    if (override && !/^wss?:\/\//.test(override)) {
      setError('The advanced WebSocket URL must start with ws:// or wss://.')
      return
    }
    setPending('create')
    setError(undefined)
    try {
      const result = await postPanel<PanelHarnessPairingMutationResponse>(
        '/panel/api/v1/harnesses/pairings',
        {
          kind,
          label: HARNESS_KINDS.find((item) => item.kind === kind)?.label ?? kind,
          transport: copyTransport,
          ...(machine === 'local' && override ? { wsUrl: override } : {}),
        }
      )
      setPairing(result.pairing)
      setJob(undefined)
      setConnection(undefined)
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const install = async () => {
    if (pending || !installReady) return
    setPending('install')
    setError(undefined)
    try {
      const port = sshPort.trim() ? Number(sshPort.trim()) : undefined
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
        throw new Error('The SSH port must be between 1 and 65535.')
      }
      const input: PanelInstallStart = {
        kind,
        method: machine === 'remote' ? 'ssh' : 'docker',
        ...(machine === 'remote'
          ? {
              host: manualSsh
                ? {
                    hostname: sshHostname.trim(),
                    ...(sshUser.trim() ? { user: sshUser.trim() } : {}),
                    ...(port !== undefined ? { port } : {}),
                  }
                : { alias: sshHost },
            }
          : { container }),
        ...(kind === 'opencode' && opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
      }
      // A new target replaces a running install so two targets cannot race.
      if (job?.state === 'running') {
        await cancelInstallJob(job.id).catch(() => undefined)
      }
      const result = await startInstall(input)
      // The install response carries the pairing that matches the target; the
      // copy-path code created by begin() is no longer the one to show.
      if (pairing && pairing.id !== result.pairing.id) {
        void deletePanel(
          `/panel/api/v1/harnesses/pairings/${encodeURIComponent(pairing.id)}`
        ).catch(() => undefined)
      }
      setPairing(result.pairing)
      setJob(result.job)
      setConnection(undefined)
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const cancelInstall = async () => {
    if (!job || job.state !== 'running') return
    setError(undefined)
    try {
      await cancelInstallJob(job.id)
      setJob({ ...job, state: 'cancelled', lines: [...job.lines, 'Cancelling the install…'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const dispose = async (): Promise<boolean> => {
    if (job?.state === 'running') {
      await cancelInstallJob(job.id).catch(() => undefined)
    }
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
    machine,
    kind,
    ...(pairing ? { pairing } : {}),
    ...(job ? { job } : {}),
    ...(connection ? { connection } : {}),
    expired,
    step,
    ...(info ? { info } : {}),
    infoLoading,
    ...(infoError ? { infoError } : {}),
    installEnabled,
    installAvailable: installReady,
    relayUsable,
    localUsable,
    canContinue,
    ...(notice ? { notice } : {}),
    ...(dockerRelayNotice ? { dockerRelayNotice } : {}),
    sshHosts,
    containers,
    sshHost,
    sshHostname,
    sshUser,
    sshPort,
    container,
    opencodeUrl,
    wsUrl,
    defaultWsUrl: snapshot.local.url,
    ...(pending ? { pending } : {}),
    ...(error ? { error } : {}),
    setMachine,
    setKind,
    setSshHost,
    setSshHostname,
    setSshUser,
    setSshPort,
    setContainer,
    setOpencodeUrl,
    setWsUrl,
    refreshInfo: loadInfo,
    begin,
    install,
    cancelInstall,
    close,
    startOver,
    reportError: setError,
  }
}
