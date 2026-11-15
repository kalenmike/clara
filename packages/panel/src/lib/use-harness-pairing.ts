import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildAdapterInstallLink,
  decodeHarnessPairingCode,
  parseAdapterInstallLink,
  type AdapterInstallJob,
  type AdapterInstallMethod,
  type AdapterInstallOffer,
  type PanelHarness,
  type PanelHarnessPairing,
  type PanelInstallDockerContainer,
  type PanelInstallInfo,
  type PanelInstallSshHost,
  type PanelSnapshot,
} from '@clara/shared-types'
import {
  HARNESS_KINDS,
  defaultHarnessTarget,
  directHarnessTransport,
  findHarnessPairingConnection,
  resolveHarnessTransport,
  type HarnessMachine,
  type HarnessTarget,
  type HarnessTransportMode,
} from './harness-pairing.ts'
import { findFeature } from './feature-control.ts'
import {
  createAdapterOffer,
  fetchInstallInfo,
  installManifest,
  registryCommand,
  registryError,
} from './install.ts'
import { deletePanel } from './panel-api.ts'
import { usePanelAdapterHost, usePanelRuntime } from './runtime-context.ts'

/** The panel uses a sentinel because an SSH alias is a free-text select value. */
export const MANUAL_SSH_HOST = '__manual__'

type HarnessPairingPending = 'create' | 'install' | 'close'

export type HarnessPairingFlow = {
  kind: string
  machine: HarnessMachine
  target: HarnessTarget
  transport: HarnessTransportMode
  defaultTransport: 'local' | 'relay'
  pairing?: AdapterInstallOffer['pairing']
  offer?: AdapterInstallOffer
  connection?: PanelHarness
  job?: AdapterInstallJob
  expired: boolean
  imported: boolean
  step: 1 | 2
  info?: PanelInstallInfo
  infoLoading: boolean
  infoError?: string
  targetsError?: string
  installEnabled: boolean
  installAvailable: boolean
  canContinue: boolean
  canInstall: boolean
  adapterHost: boolean
  notice?: string
  transportNotice?: string
  sshHosts: PanelInstallSshHost[]
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
  setTarget: (target: HarnessTarget) => void
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
 * Drives the harness pairing modal. The person chooses where the adapter will
 * run and, when the client shell supplies an adapter host, the panel can run
 * the install itself. The hub-served panel has no adapter host, so it shows the
 * code and command for the person to run.
 */
export function useHarnessPairing({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
  initialCode,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose?: () => void
  initialCode?: string
}): HarnessPairingFlow {
  const host = usePanelAdapterHost()
  const runtime = usePanelRuntime()
  const installEnabled = snapshot.controls.install.enabled
  const relayUsable = snapshot.relay.configured && findFeature(snapshot.controls, 'relay').effective
  const localUsable = findFeature(snapshot.controls, 'local').effective
  const containerized = snapshot.agent.container
  const defaultTransport = runtime.defaultTransport ?? 'local'

  const [machine, setMachine] = useState<HarnessMachine>('local')
  const [target, setTarget] = useState<HarnessTarget>(() => defaultHarnessTarget(containerized))
  const [kind, setKind] = useState<string>(HARNESS_KINDS[0].kind)
  const [offer, setOffer] = useState<AdapterInstallOffer>()
  const [connection, setConnection] = useState<PanelHarness>()
  const [job, setJob] = useState<AdapterInstallJob>()
  const [pending, setPending] = useState<HarnessPairingPending>()
  const [error, setError] = useState<string>()
  const [imported, setImported] = useState(false)

  const [info, setInfo] = useState<PanelInstallInfo>()
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState<string>()
  const [targetsError, setTargetsError] = useState<string>()
  const [sshHosts, setSshHosts] = useState<PanelInstallSshHost[]>([])
  const [containers, setContainers] = useState<PanelInstallDockerContainer[]>([])

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

  useEffect(() => {
    if (!open || !host) return
    let active = true
    setTargetsError(undefined)
    void host
      .targets()
      .then((value) => {
        if (!active) return
        setSshHosts(value.ssh.hosts)
        setContainers(value.docker.containers)
        if (!value.ssh.available && value.ssh.reason) setTargetsError(value.ssh.reason)
        else if (!value.docker.available && value.docker.reason)
          setTargetsError(value.docker.reason)
      })
      .catch((cause: unknown) => {
        if (active) setTargetsError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [host, open])

  const reset = useCallback(() => {
    setOffer(undefined)
    setConnection(undefined)
    setJob(undefined)
    setPending(undefined)
    setError(undefined)
    setImported(false)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const direct = wsUrl.trim().length > 0
  const selectedTarget: HarnessTarget = machine === 'remote' ? 'host' : target
  const autoTransport = resolveHarnessTransport({
    machine,
    target: selectedTarget,
    containerized,
    defaultTransport,
  })
  const transport: HarnessTransportMode = direct
    ? directHarnessTransport({ target: selectedTarget, containerized })
    : autoTransport
  const method: AdapterInstallMethod =
    machine === 'remote' ? 'ssh' : selectedTarget === 'container' ? 'docker' : 'local'

  const pairing = offer?.pairing
  const step: 1 | 2 = pairing ? 2 : 1
  const installAvailable = installEnabled && info?.available === true
  const manifest = installManifest(info, kind)
  const transportUsable = transport === 'relay' ? relayUsable : localUsable
  const canContinue =
    !snapshot.controls.stopped && installAvailable && transportUsable && Boolean(manifest)

  const manualSsh = sshHost === MANUAL_SSH_HOST
  const hostReady = manualSsh ? sshHostname.trim().length > 0 : Boolean(sshHost)
  const targetReady = method === 'ssh' ? hostReady : method === 'docker' ? Boolean(container) : true
  const canInstall =
    Boolean(host && offer?.manifest && pairing) &&
    installEnabled &&
    !snapshot.controls.stopped &&
    targetReady &&
    job?.state !== 'running'

  const notice = snapshot.controls.stopped
    ? 'External connections are off. Turn them on from Overview before pairing an adapter.'
    : !installEnabled
      ? 'Adapter setup is off. Turn it on in Settings → Adapter downloads.'
      : info && !info.available
        ? info.reason
        : !transportUsable
          ? transport === 'relay'
            ? machine === 'remote'
              ? 'Relay pairing is unavailable. Configure or enable the relay from Network, or enter a direct WebSocket URL.'
              : 'Relay pairing is unavailable. A container cannot reach the hub loopback listener; configure the relay or enter a direct WebSocket URL.'
            : 'Local transport is off. Turn it on from Network before pairing a local adapter.'
          : info && !manifest
            ? (registryError(info, kind) ?? 'No adapter release is published for this harness.')
            : undefined

  const transportNotice = direct
    ? 'The adapter will use the WebSocket URL you entered.'
    : machine === 'local' && selectedTarget === 'container' && !containerized
      ? 'This hub runs as a host process, so an adapter inside a container connects through the relay.'
      : defaultTransport === 'relay' && machine === 'local'
        ? 'This panel is connected through the relay; a local adapter uses the relay unless you enter an address it can reach.'
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

  const importedRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!open) {
      importedRef.current = undefined
      return
    }
    if (!initialCode || !info) return
    if (importedRef.current === initialCode) return

    const code = parseAdapterInstallLink(initialCode) ?? initialCode
    const payload = decodeHarnessPairingCode(code)
    if (!payload) {
      importedRef.current = initialCode
      setError('The link did not contain a valid adapter pairing code.')
      return
    }

    const label = HARNESS_KINDS.find((item) => item.kind === payload.kind)?.label ?? payload.kind
    const importedManifest = installManifest(info, payload.kind)
    const command = registryCommand(info, payload.kind, code)
    const importedPairing: PanelHarnessPairing = {
      id: payload.enrollId,
      kind: payload.kind,
      label,
      code,
      transport: payload.room === 'local' ? 'local' : 'relay',
      wsUrl: payload.wsUrl,
      room: payload.room,
      fingerprint: payload.fingerprint,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      createdAt: new Date().toISOString(),
    }

    setKind(payload.kind)
    setImported(true)
    setOffer({
      pairing: importedPairing,
      ...(importedManifest ? { manifest: importedManifest } : {}),
      ...(command ? { command } : {}),
      deepLink: buildAdapterInstallLink(code, payload.kind),
    })
    setConnection(undefined)
    setJob(undefined)
    setError(
      importedManifest ? undefined : 'The adapter release for this pairing code is unavailable.'
    )
    importedRef.current = initialCode
  }, [info, initialCode, open])

  const jobId = job?.id
  const running = job?.state === 'running'
  useEffect(() => {
    if (!host || !jobId || !running) return
    let active = true
    const timer = window.setInterval(() => {
      void host
        .job(jobId)
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
  }, [host, jobId, running])

  const begin = async () => {
    if (pending || !canContinue) return
    const directUrl = wsUrl.trim()
    if (directUrl && !/^wss?:\/\//i.test(directUrl)) {
      setError('The WebSocket URL must start with ws:// or wss://.')
      return
    }
    setPending('create')
    setError(undefined)
    try {
      const next = await createAdapterOffer({
        kind,
        method,
        transport,
        ...(transport !== 'relay' && directUrl ? { wsUrl: directUrl } : {}),
        ...(kind === 'opencode' && opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
      })
      setImported(false)
      setOffer(next)
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
    if (pending || !canInstall || !host || !offer?.manifest || !pairing) return
    setPending('install')
    setError(undefined)
    try {
      const port = sshPort.trim() ? Number(sshPort.trim()) : undefined
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
        throw new Error('The SSH port must be between 1 and 65535.')
      }
      const next = await host.start({
        kind: pairing.kind,
        method,
        pairingCode: pairing.code,
        manifest: offer.manifest,
        ...(method === 'ssh'
          ? {
              host: manualSsh
                ? {
                    hostname: sshHostname.trim(),
                    ...(sshUser.trim() ? { user: sshUser.trim() } : {}),
                    ...(port !== undefined ? { port } : {}),
                  }
                : { alias: sshHost },
            }
          : {}),
        ...(method === 'docker' ? { container } : {}),
        ...(pairing.kind === 'opencode' && opencodeUrl.trim()
          ? { opencodeUrl: opencodeUrl.trim() }
          : {}),
      })
      setJob(next)
      setConnection(undefined)
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const cancelInstall = async () => {
    if (!host || !job || job.state !== 'running') return
    setError(undefined)
    try {
      await host.cancel(job.id)
      setJob({ ...job, state: 'cancelled', lines: [...job.lines, 'Cancelling the install…'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const dispose = async (): Promise<boolean> => {
    if (host && job?.state === 'running') {
      await host.cancel(job.id).catch(() => undefined)
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
    kind,
    machine,
    target,
    transport,
    defaultTransport,
    ...(pairing ? { pairing } : {}),
    ...(offer ? { offer } : {}),
    ...(connection ? { connection } : {}),
    ...(job ? { job } : {}),
    expired,
    imported,
    step,
    ...(info ? { info } : {}),
    infoLoading,
    ...(infoError ? { infoError } : {}),
    ...(targetsError ? { targetsError } : {}),
    installEnabled,
    installAvailable,
    canContinue,
    canInstall,
    adapterHost: Boolean(host),
    ...(notice ? { notice } : {}),
    ...(transportNotice ? { transportNotice } : {}),
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
    setTarget,
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
