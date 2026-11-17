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
  type PanelLocalAddress,
  type PanelSnapshot,
} from '@clara/shared-types'
import {
  HARNESS_KINDS,
  defaultHarnessConnectionMode,
  defaultHarnessTarget,
  directHarnessTransport,
  findHarnessPairingConnection,
  harnessNeedsAddress,
  isLoopbackSocketUrl,
  type HarnessConnectionMode,
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
  connectionMode: HarnessConnectionMode
  relayUsable: boolean
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
  sshError?: string
  dockerError?: string
  installEnabled: boolean
  installAvailable: boolean
  canContinue: boolean
  canInstall: boolean
  adapterHost: boolean
  needsAddress: boolean
  addressCandidates: PanelLocalAddress[]
  containerUrl?: string
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
  setConnectionMode: (mode: HarnessConnectionMode) => void
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
  const containerUrl = snapshot.local.containerUrl
  const detectedAddresses = snapshot.local.addresses ?? []

  const initialTarget = defaultHarnessTarget(containerized)
  const [machine, setMachine] = useState<HarnessMachine>('remote')
  const [target, setTarget] = useState<HarnessTarget>(initialTarget)
  const [kind, setKind] = useState<string>(HARNESS_KINDS[0].kind)
  const [connectionMode, setConnectionModeState] = useState<HarnessConnectionMode>(() =>
    defaultHarnessConnectionMode({
      machine: 'remote',
      target: initialTarget,
      containerized,
      relayUsable,
      defaultTransport,
      ...(containerUrl ? { containerUrl } : {}),
    })
  )
  const [modeTouched, setModeTouched] = useState(false)
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
  const [sshError, setSshError] = useState<string>()
  const [dockerError, setDockerError] = useState<string>()
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
    setSshError(undefined)
    setDockerError(undefined)
    void host
      .targets()
      .then((value) => {
        if (!active) return
        setSshHosts(value.ssh.hosts)
        setContainers(value.docker.containers)
        setSshError(value.ssh.available ? undefined : value.ssh.reason)
        setDockerError(value.docker.available ? undefined : value.docker.reason)
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

  useEffect(() => {
    if (open) return
    setMachine('remote')
    setTarget(defaultHarnessTarget(containerized))
  }, [containerized, open])

  const directMode = connectionMode === 'direct'
  const directUrl = wsUrl.trim()
  const selectedTarget: HarnessTarget = machine === 'remote' ? 'host' : target
  const transport: HarnessTransportMode = directMode
    ? directHarnessTransport({ target: selectedTarget, containerized })
    : 'relay'
  const method: AdapterInstallMethod =
    machine === 'remote' ? 'ssh' : selectedTarget === 'container' ? 'docker' : 'local'

  useEffect(() => {
    if (!open) {
      setModeTouched(false)
      return
    }
    if (modeTouched) return
    setConnectionModeState(
      defaultHarnessConnectionMode({
        machine,
        target: selectedTarget,
        containerized,
        relayUsable,
        defaultTransport,
        ...(containerUrl ? { containerUrl } : {}),
      })
    )
  }, [
    open,
    modeTouched,
    machine,
    selectedTarget,
    containerized,
    relayUsable,
    defaultTransport,
    containerUrl,
  ])

  const setConnectionMode = (mode: HarnessConnectionMode) => {
    setModeTouched(true)
    setConnectionModeState(mode)
  }

  const addressCandidates = containerCandidates({
    machine,
    target: selectedTarget,
    container,
    containers,
    detected: detectedAddresses,
    port: snapshot.local.port,
    dockerReachable: (snapshot.local.access ?? 'loopback') !== 'loopback',
  })

  const pairing = offer?.pairing
  const step: 1 | 2 = pairing ? 2 : 1
  const installAvailable = installEnabled && info?.available === true
  const manifest = installManifest(info, kind)
  const transportUsable = directMode ? localUsable : relayUsable
  const directProtocolInvalid = directMode && directUrl.length > 0 && !/^ws:\/\//i.test(directUrl)
  const directLoopback =
    directMode &&
    isLoopbackSocketUrl(wsUrl) &&
    (machine === 'remote' || (selectedTarget === 'container' && !containerized))
  const needsAddress = directMode
    ? harnessNeedsAddress({
        machine,
        target: selectedTarget,
        containerized,
        relayUsable,
        ...(containerUrl ? { containerUrl } : {}),
        direct: directUrl.length > 0,
      })
    : !relayUsable
  const manualSsh = sshHost === MANUAL_SSH_HOST
  const hostReady = manualSsh ? sshHostname.trim().length > 0 : Boolean(sshHost)
  const targetReady = method === 'ssh' ? hostReady : method === 'docker' ? Boolean(container) : true
  const canContinue =
    !snapshot.controls.stopped &&
    installAvailable &&
    Boolean(manifest) &&
    !needsAddress &&
    !directProtocolInvalid &&
    transportUsable &&
    (!host || targetReady)

  const canInstall =
    Boolean(host && offer?.manifest && pairing) &&
    installEnabled &&
    !snapshot.controls.stopped &&
    targetReady &&
    job?.state !== 'running'

  const notice = snapshot.controls.stopped
    ? 'External connections are off. Turn them on from Overview before pairing an adapter.'
    : !installEnabled
      ? 'Adapter setup is off. Turn it on in Network → Adapter setup.'
      : info && !info.available
        ? info.reason
        : !transportUsable
          ? directMode
            ? 'Local transport is off. Turn it on from Network before pairing a direct adapter.'
            : 'Relay pairing is unavailable. Configure the relay from Network or choose Direct.'
          : needsAddress
            ? machine === 'remote'
              ? 'Enter the hub WebSocket URL the remote machine can reach, or configure the relay from Network.'
              : 'Enter the hub WebSocket URL the container can reach, or allow Docker access from Network.'
            : directProtocolInvalid
              ? 'A direct WebSocket URL must start with ws://. Use the relay for a wss:// pairing.'
              : directLoopback
                ? 'This address is loopback. A remote or container adapter can only use it through an SSH or port-forwarding tunnel.'
                : info && !manifest
                  ? (registryError(info, kind) ??
                    'No adapter release is published for this harness.')
                  : undefined

  const transportNotice = directMode
    ? directUrl
      ? 'The adapter will use the WebSocket URL you entered.'
      : machine === 'local' && selectedTarget === 'container' && !containerized
        ? containerUrl
          ? `The adapter will connect through ${containerUrl}.`
          : 'Enter a WebSocket URL the container can reach, or allow Docker access from Network.'
        : machine === 'remote'
          ? 'Enter the WebSocket URL the remote machine can reach, or choose Relay.'
          : 'The adapter will use the hub default address for this target.'
    : relayUsable
      ? 'The adapter will connect through the relay.'
      : 'Configure the relay from Network, or choose Direct.'

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

  const startInstall = async (targetOffer: AdapterInstallOffer) => {
    if (!host || !installEnabled || snapshot.controls.stopped) return
    if (!targetOffer.manifest || !targetReady || job?.state === 'running') return
    setPending('install')
    setError(undefined)
    try {
      const port = sshPort.trim() ? Number(sshPort.trim()) : undefined
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
        throw new Error('The SSH port must be between 1 and 65535.')
      }
      const next = await host.start({
        kind: targetOffer.pairing.kind,
        method,
        pairingCode: targetOffer.pairing.code,
        manifest: targetOffer.manifest,
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
        ...(targetOffer.pairing.kind === 'opencode' && opencodeUrl.trim()
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

  const begin = async () => {
    if (pending || !canContinue) return
    if (directMode && directUrl && !/^ws:\/\//i.test(directUrl)) {
      setError('A direct WebSocket URL must start with ws://.')
      return
    }
    setPending('create')
    setError(undefined)
    try {
      const next = await createAdapterOffer({
        kind,
        method,
        transport,
        ...(directMode && directUrl ? { wsUrl: directUrl } : {}),
        ...(kind === 'opencode' && opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
      })
      setImported(false)
      setOffer(next)
      setJob(undefined)
      setConnection(undefined)
      onChangedRef.current()
      await startInstall(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const install = async () => {
    if (pending || !canInstall || !offer) return
    await startInstall(offer)
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
    connectionMode,
    relayUsable,
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
    ...(sshError ? { sshError } : {}),
    ...(dockerError ? { dockerError } : {}),
    installEnabled,
    installAvailable,
    canContinue,
    canInstall,
    adapterHost: Boolean(host),
    needsAddress,
    addressCandidates,
    ...(containerUrl ? { containerUrl } : {}),
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
    defaultWsUrl:
      selectedTarget === 'container' && !containerized && containerUrl
        ? containerUrl
        : snapshot.local.url,
    ...(pending ? { pending } : {}),
    ...(error ? { error } : {}),
    setMachine,
    setTarget,
    setKind,
    setConnectionMode,
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

/**
 * Address suggestions for the pairing modal. The hub contributes its bound
 * addresses; a selected local container adds its own Docker gateway, which is
 * the one address the container can definitely route to.
 */
function containerCandidates(input: {
  machine: HarnessMachine
  target: HarnessTarget
  container: string
  containers: PanelInstallDockerContainer[]
  detected: PanelLocalAddress[]
  port: number
  dockerReachable: boolean
}): PanelLocalAddress[] {
  const candidates = new Map<string, PanelLocalAddress>()
  const add = (address: PanelLocalAddress) => {
    if (!candidates.has(address.url)) candidates.set(address.url, address)
  }
  for (const address of input.detected) add(address)
  if (
    input.machine !== 'local' ||
    input.target !== 'container' ||
    !input.container ||
    !input.dockerReachable
  ) {
    return [...candidates.values()]
  }
  const selected = input.containers.find((item) => item.name === input.container)
  for (const gateway of selected?.gateways ?? []) {
    add({
      scope: 'docker',
      host: gateway,
      url: `ws://${gateway}:${input.port}/ws`,
    })
  }
  add({
    scope: 'docker',
    host: 'host.docker.internal',
    url: `ws://host.docker.internal:${input.port}/ws`,
  })
  return [...candidates.values()]
}
