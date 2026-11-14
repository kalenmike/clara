import { useCallback, useEffect, useRef, useState } from 'react'
import { Cable, RefreshCw, X } from 'lucide-react'
import type {
  PanelHarness,
  PanelHarnessPairing,
  PanelInstallInfo,
  PanelInstallJob,
} from '@clara/shared-types'
import { isPairingRegistered } from '../lib/harness-pairing.ts'
import {
  cancelInstallJob,
  fetchInstallInfo,
  fetchInstallJob,
  installManifest,
  registryCommand,
  registryError,
  repoCommand,
  startInstall,
  supportedPlatforms,
} from '../lib/install.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CopyButton, Notice, type Tone } from './primitives.tsx'

const MANUAL = '__manual__'

const JOB_TONE: Record<PanelInstallJob['state'], Tone> = {
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
}

const JOB_LABEL: Record<PanelInstallJob['state'], string> = {
  running: 'Installing',
  succeeded: 'Installed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function HarnessRemoteInstall({
  method,
  kind,
  harnesses,
  relayConfigured,
  containerized,
  onChanged,
}: {
  method: 'ssh' | 'docker'
  kind: string
  harnesses: PanelHarness[]
  relayConfigured: boolean
  containerized: boolean
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])
  const [info, setInfo] = useState<PanelInstallInfo>()
  const [loading, setLoading] = useState(true)
  const [infoError, setInfoError] = useState<string>()
  const [sshHost, setSshHost] = useState('')
  const [sshHostname, setSshHostname] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [container, setContainer] = useState('')
  const [opencodeUrl, setOpencodeUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [pairing, setPairing] = useState<PanelHarnessPairing>()
  const [job, setJob] = useState<PanelInstallJob>()
  const [connected, setConnected] = useState(false)

  const loadInfo = useCallback(async () => {
    setLoading(true)
    setInfoError(undefined)
    try {
      setInfo(await fetchInstallInfo())
    } catch (cause) {
      setInfoError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

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
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        })
    }, 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [jobId, running])

  useEffect(() => {
    if (!pairing || connected) return
    if (!isPairingRegistered(pairing, harnesses)) return
    setConnected(true)
    onChangedRef.current()
  }, [pairing, harnesses, connected])

  const manifest = installManifest(info, kind)
  const registry = registryError(info, kind)
  const manualSsh = sshHost === MANUAL
  const sshAlias = sshHost && !manualSsh ? sshHost : undefined
  const hostReady = manualSsh ? sshHostname.trim().length > 0 : Boolean(sshAlias)
  const targetReady = method === 'ssh' ? hostReady : container.length > 0
  const platforms = supportedPlatforms(manifest)
  const transportReady = method === 'ssh' ? relayConfigured : containerized || relayConfigured

  const reset = () => {
    setPairing(undefined)
    setJob(undefined)
    setConnected(false)
    setError(undefined)
  }

  const install = async () => {
    setPending(true)
    setError(undefined)
    setConnected(false)
    try {
      const port = sshPort.trim() ? Number(sshPort.trim()) : undefined
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
        throw new Error('The SSH port must be between 1 and 65535.')
      }
      const result = await startInstall({
        kind,
        method,
        ...(method === 'ssh'
          ? {
              host: sshAlias
                ? { alias: sshAlias }
                : {
                    hostname: sshHostname.trim(),
                    ...(sshUser.trim() ? { user: sshUser.trim() } : {}),
                    ...(port !== undefined ? { port } : {}),
                  },
            }
          : { container }),
        ...(kind === 'opencode' && opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
      })
      setPairing(result.pairing)
      setJob(result.job)
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    setError(undefined)
    try {
      await cancelInstallJob(job.id)
      setJob({ ...job, state: 'cancelled', lines: [...job.lines, 'Cancelling the install…'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (loading && !info) {
    return <p className="panel-muted text-[11px]">Reading the adapter registry and targets…</p>
  }

  return (
    <div className="space-y-3">
      {infoError ? <Notice tone="danger">{redact(infoError)}</Notice> : null}
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
      {info && !info.available ? (
        <Notice>{redact(info.reason ?? 'Adapter installs are not available.')}</Notice>
      ) : null}
      {info && info.available && method === 'ssh' && !info.ssh.available ? (
        <Notice tone="danger">
          {redact(info.ssh.reason ?? 'SSH is not available on the hub host.')}
        </Notice>
      ) : null}
      {info && info.available && method === 'docker' && !info.docker.available ? (
        <Notice tone="danger">
          {redact(info.docker.reason ?? 'Docker is not available on the hub host.')}
        </Notice>
      ) : null}
      {registry ? (
        <Notice tone="danger">No adapter release is available: {redact(registry)}</Notice>
      ) : null}
      {!transportReady ? (
        <Notice>
          {containerized
            ? 'The adapter will use the hub Docker network.'
            : 'Configure the relay before installing. A remote host or container cannot reach the hub loopback listener.'}
        </Notice>
      ) : null}

      {manifest ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-2 text-[11px] dark:border-neutral-800">
          <Badge tone="info">v{manifest.version}</Badge>
          <span className="panel-muted">
            {platforms.length} platform {platforms.length === 1 ? 'build' : 'builds'}
          </span>
          <button
            type="button"
            onClick={() => void loadInfo()}
            disabled={loading}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-neutral-100"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      ) : null}

      {pairing ? null : (
        <div className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800">
          {method === 'ssh' ? (
            <>
              <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 sm:col-span-2 dark:text-neutral-300">
                SSH host
                <select
                  value={sshHost}
                  onChange={(event) => setSshHost(event.target.value)}
                  className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="">Choose a host…</option>
                  {(info?.ssh.hosts ?? []).map((host) => (
                    <option key={host.alias} value={host.alias}>
                      {host.alias} — {host.user ? `${host.user}@` : ''}
                      {host.hostname}
                      {host.port ? `:${host.port}` : ''}
                    </option>
                  ))}
                  <option value={MANUAL}>Enter manually…</option>
                </select>
              </label>
              {manualSsh ? (
                <>
                  <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                    Hostname
                    <input
                      value={sshHostname}
                      onChange={(event) => setSshHostname(event.target.value)}
                      placeholder="server.example"
                      className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                  <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                    User
                    <input
                      value={sshUser}
                      onChange={(event) => setSshUser(event.target.value)}
                      placeholder="ubuntu"
                      className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                  <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                    Port
                    <input
                      value={sshPort}
                      onChange={(event) => setSshPort(event.target.value)}
                      placeholder="22"
                      inputMode="numeric"
                      className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : (
            <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 sm:col-span-2 dark:text-neutral-300">
              Container
              <select
                value={container}
                onChange={(event) => setContainer(event.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="">Choose a running container…</option>
                {(info?.docker.containers ?? []).map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name} — {item.image}
                    {item.project ? ` · ${item.project}` : ''}
                  </option>
                ))}
              </select>
              {info?.docker.available && (info.docker.containers ?? []).length === 0 ? (
                <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                  No running containers. Start the harness container first.
                </span>
              ) : null}
              <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                The adapter is installed inside the selected container. Use a container with a
                mounted config path if it is recreated.
              </span>
            </label>
          )}

          {kind === 'opencode' ? (
            <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 sm:col-span-2 dark:text-neutral-300">
              OpenCode URL <span className="font-normal text-neutral-500">(optional)</span>
              <input
                value={opencodeUrl}
                onChange={(event) => setOpencodeUrl(event.target.value)}
                placeholder={method === 'docker' ? 'http://opencode:4096' : 'http://127.0.0.1:4096'}
                className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              />
              <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                Pass an explicit OpenCode URL when the installer cannot discover it on the target.
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => void install()}
              disabled={
                pending ||
                !info?.available ||
                !manifest ||
                !targetReady ||
                (method === 'ssh' && !info?.ssh.available) ||
                (method === 'docker' && !info?.docker.available)
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-950"
            >
              <Cable className="size-3.5" aria-hidden="true" />
              {pending ? 'Starting…' : 'Install adapter'}
            </button>
            <button
              type="button"
              onClick={() => void loadInfo()}
              disabled={loading}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh targets
            </button>
          </div>
        </div>
      )}

      {job ? (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={JOB_TONE[job.state]}>{JOB_LABEL[job.state]}</Badge>
            <span className="panel-muted text-[11px]">
              {job.target} · {job.kind}
            </span>
            {running ? (
              <button
                type="button"
                onClick={() => void cancel()}
                className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <X className="size-3" aria-hidden="true" />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={reset}
                className="ml-auto text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Done
              </button>
            )}
          </div>
          {connected ? (
            <Notice tone="success">
              The adapter connected. It is listed under Paired harnesses.
            </Notice>
          ) : null}
          <pre className="max-h-52 overflow-auto rounded-md bg-neutral-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-neutral-100">
            {job.lines.join('\n')}
          </pre>
          {pairing ? (
            <>
              <p className="panel-muted text-[11px]">
                If the install did not finish, run this on the target with code{' '}
                <span className="font-mono">{pairing.code}</span>.
              </p>
              <CommandBlock
                label="Registry command"
                value={
                  registryCommand(info, pairing.kind, pairing.code) ??
                  repoCommand(pairing.kind, pairing.code)
                }
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CommandBlock({ label, value }: { label: string; value: string }) {
  const [error, setError] = useState<string>()
  return (
    <div className="space-y-1">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          {label}
        </span>
        <CopyButton value={value} label="Copy" onError={setError} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
        {value}
      </pre>
    </div>
  )
}
