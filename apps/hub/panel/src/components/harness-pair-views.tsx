import { useEffect, useRef, type ReactNode } from 'react'
import { Check, Globe2, LoaderCircle, Wifi, X } from 'lucide-react'
import type { PanelInstallJob } from '@clara/shared-types'
import { formatRelative } from '../lib/format.ts'
import { HARNESS_KINDS } from '../lib/harness-pairing.ts'
import { repoCommand, registryCommand } from '../lib/install.ts'
import type { HarnessPairingFlow } from '../lib/use-harness-pairing.ts'
import { MANUAL_SSH_HOST } from '../lib/use-harness-pairing.ts'
import { Badge, CopyButton, Notice, type Tone } from './primitives.tsx'

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

export function HarnessPairHeader({
  pending,
  onClose,
}: {
  pending: HarnessPairingFlow['pending']
  onClose: () => void
}) {
  return (
    <header className="panel-setup-head">
      <div className="min-w-0">
        <div className="panel-muted text-[10px] font-semibold tracking-[0.08em] uppercase">
          Harnesses
        </div>
        <h2 id="panel-harness-pair-title" className="mt-0.5 text-base font-semibold">
          Pair a harness
        </h2>
        <p className="panel-muted mt-1 text-xs">
          Pair an adapter from the machine that runs the harness
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close harness pairing"
        disabled={pending !== undefined}
        className="panel-icon-button shrink-0"
      >
        {pending === 'close' ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-4" aria-hidden="true" />
        )}
      </button>
    </header>
  )
}

export function HarnessPairContent({ flow, now }: { flow: HarnessPairingFlow; now: number }) {
  return (
    <div className="space-y-4">
      {flow.error ? <Notice tone="danger">{flow.error}</Notice> : null}
      {flow.infoError ? <Notice tone="danger">{flow.infoError}</Notice> : null}
      {flow.notice ? <Notice>{flow.notice}</Notice> : null}
      {flow.step === 1 ? <MachineStep flow={flow} /> : <TargetStep flow={flow} now={now} />}
    </div>
  )
}

function MachineStep({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <div className="space-y-4">
      <label className="grid gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
        Harness
        <select
          value={flow.kind}
          onChange={(event) => flow.setKind(event.target.value)}
          className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          {HARNESS_KINDS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
          On which machine is your harness running?
        </p>
        <div
          role="radiogroup"
          aria-label="Harness machine"
          className="mt-2 grid gap-2 sm:grid-cols-2"
        >
          <MachineChoice
            active={flow.machine === 'remote'}
            onSelect={() => flow.setMachine('remote')}
            icon={<Globe2 className="size-4" aria-hidden="true" />}
            title="Remote"
            description="Another machine, installed over SSH or with a command you copy."
          />
          <MachineChoice
            active={flow.machine === 'local'}
            onSelect={() => flow.setMachine('local')}
            icon={<Wifi className="size-4" aria-hidden="true" />}
            title="Local"
            description="This machine, either directly or inside one of its Docker containers."
          />
        </div>
      </div>

      {flow.machine === 'local' ? (
        <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            Advanced
          </summary>
          <label className="mt-2 grid gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            WebSocket URL
            <input
              value={flow.wsUrl}
              onChange={(event) => flow.setWsUrl(event.target.value)}
              placeholder={flow.defaultWsUrl}
              spellCheck={false}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-950"
            />
            <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
              Leave blank to use the hub&apos;s local listener. Set it when the adapter reaches the
              hub at another address.
            </span>
          </label>
        </details>
      ) : null}
    </div>
  )
}

function TargetStep({ flow, now }: { flow: HarnessPairingFlow; now: number }) {
  const pairing = flow.pairing
  const lastTarget = useRef('')
  const installRef = useRef(flow.install)
  useEffect(() => {
    installRef.current = flow.install
  })

  // A host alias or a container is the whole action on this screen: choosing
  // one runs the install. Manual SSH keeps an explicit button because a typed
  // hostname is not complete until the person stops typing.
  const autoTarget =
    flow.machine === 'remote'
      ? flow.sshHost && flow.sshHost !== MANUAL_SSH_HOST
        ? flow.sshHost
        : ''
      : flow.container

  useEffect(() => {
    if (!autoTarget) {
      lastTarget.current = ''
      return
    }
    if (lastTarget.current === autoTarget) return
    if (!flow.installEnabled || !flow.installAvailable) return
    if (flow.connection || flow.expired) return
    lastTarget.current = autoTarget
    void installRef.current()
  }, [autoTarget, flow.connection, flow.expired, flow.installAvailable, flow.installEnabled])

  if (!pairing) return null
  const registry = registryCommand(flow.info, pairing.kind, pairing.code)
  const command = registry ?? repoCommand(pairing.kind, pairing.code)
  const failed = flow.job?.state === 'failed' || flow.job?.state === 'cancelled'

  return (
    <div className="space-y-4">
      <div>
        <span className="inline-flex rounded-md border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-800 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
          {flow.machine === 'remote' ? 'SSH' : 'Docker'}
        </span>
      </div>

      {flow.dockerRelayNotice ? <Notice>{flow.dockerRelayNotice}</Notice> : null}

      {flow.machine === 'remote' ? <SshTarget flow={flow} /> : <DockerTarget flow={flow} />}

      <div className="space-y-1 text-center">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Expires {formatRelative(pairing.expiresAt, now)}. It enrolls one adapter.
        </p>
        <p
          className={`flex items-center justify-center gap-1.5 text-[11px] ${
            flow.connection
              ? 'font-medium text-emerald-600 dark:text-emerald-400'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {flow.connection ? (
            <>
              <Check className="size-3.5" aria-hidden="true" />
              Connected · {flow.connection.label}
            </>
          ) : (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Waiting for the adapter to connect…
            </>
          )}
        </p>
      </div>

      {flow.expired ? (
        <Notice tone="danger">
          This pairing code expired. Create a new one to enroll the adapter.
        </Notice>
      ) : null}

      {!flow.installEnabled ? (
        <Notice>
          Install actions are off. Copy the code and run the command on the harness machine, or turn
          on Settings → Adapter downloads.
        </Notice>
      ) : null}

      {failed ? (
        <Notice tone="danger">
          {flow.job?.error ?? 'The adapter install did not finish. Open Advanced for the log.'}
        </Notice>
      ) : null}

      <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
          Advanced
        </summary>
        <div className="mt-3 space-y-3">
          <OpenCodeUrlField flow={flow} method={flow.machine === 'remote' ? 'ssh' : 'docker'} />
          <div className="space-y-1">
            <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Install command
            </p>
            <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
              {command}
            </pre>
          </div>
          {flow.job ? (
            <InstallJob job={flow.job} onCancel={() => void flow.cancelInstall()} />
          ) : null}
          {flow.job && flow.job.state !== 'running' && !flow.connection ? (
            <button
              type="button"
              onClick={() => void flow.install()}
              disabled={!flow.installAvailable || flow.pending !== undefined}
              className="panel-button"
            >
              Install again
            </button>
          ) : null}
        </div>
      </details>
    </div>
  )
}

function SshTarget({ flow }: { flow: HarnessPairingFlow }) {
  if (flow.infoLoading && !flow.info) {
    return <p className="panel-muted text-[11px]">Reading SSH hosts…</p>
  }
  if (flow.info && !flow.info.ssh.available) {
    return (
      <Notice tone="danger">
        {flow.info.ssh.reason ?? 'SSH is not available on the hub host.'}
      </Notice>
    )
  }
  return (
    <div className="space-y-2">
      <label className="grid gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
        Choose Host
        <select
          value={flow.sshHost}
          onChange={(event) => flow.setSshHost(event.target.value)}
          className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Choose a host…</option>
          {flow.sshHosts.map((host) => (
            <option key={host.alias} value={host.alias}>
              {host.alias} — {host.user ? `${host.user}@` : ''}
              {host.hostname}
              {host.port ? `:${host.port}` : ''}
            </option>
          ))}
          <option value={MANUAL_SSH_HOST}>Enter manually…</option>
        </select>
      </label>
      {flow.sshHost === MANUAL_SSH_HOST ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            Hostname
            <input
              value={flow.sshHostname}
              onChange={(event) => flow.setSshHostname(event.target.value)}
              placeholder="server.example"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            User
            <input
              value={flow.sshUser}
              onChange={(event) => flow.setSshUser(event.target.value)}
              placeholder="ubuntu"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            Port
            <input
              value={flow.sshPort}
              onChange={(event) => flow.setSshPort(event.target.value)}
              placeholder="22"
              inputMode="numeric"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <div className="flex items-end sm:col-span-2">
            <button
              type="button"
              onClick={() => void flow.install()}
              disabled={!flow.installAvailable || flow.pending !== undefined}
              className="panel-button primary"
            >
              {flow.pending === 'install' ? 'Starting…' : 'Install over SSH'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DockerTarget({ flow }: { flow: HarnessPairingFlow }) {
  if (flow.infoLoading && !flow.info) {
    return <p className="panel-muted text-[11px]">Reading Docker containers…</p>
  }
  if (flow.info && !flow.info.docker.available) {
    return (
      <Notice tone="danger">
        {flow.info.docker.reason ?? 'Docker is not available on the hub host.'}
      </Notice>
    )
  }
  return (
    <div className="space-y-2">
      <label className="grid gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
        Choose Container
        <select
          value={flow.container}
          onChange={(event) => flow.setContainer(event.target.value)}
          className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Choose a running container…</option>
          {flow.containers.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name} — {item.image}
              {item.project ? ` · ${item.project}` : ''}
            </option>
          ))}
        </select>
      </label>
      {flow.containers.length === 0 ? (
        <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
          No running containers. Start the harness container first, or copy the code and run the
          command inside it.
        </p>
      ) : null}
    </div>
  )
}

function OpenCodeUrlField({
  flow,
  method,
}: {
  flow: HarnessPairingFlow
  method: 'ssh' | 'docker'
}) {
  if (flow.kind !== 'opencode') return null
  return (
    <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 sm:col-span-2 dark:text-neutral-300">
      OpenCode URL <span className="font-normal text-neutral-500">(optional)</span>
      <input
        value={flow.opencodeUrl}
        onChange={(event) => flow.setOpencodeUrl(event.target.value)}
        placeholder={method === 'docker' ? 'http://opencode:4096' : 'http://127.0.0.1:4096'}
        className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
      />
      <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
        Pass an explicit OpenCode URL when the installer cannot discover it on the target.
      </span>
    </label>
  )
}

function InstallJob({ job, onCancel }: { job: PanelInstallJob; onCancel: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={JOB_TONE[job.state]}>{JOB_LABEL[job.state]}</Badge>
        <span className="panel-muted text-[11px]">
          {job.target} · {job.kind}
        </span>
        {job.state === 'running' ? (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <X className="size-3" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
      </div>
      <pre className="max-h-52 overflow-auto rounded-md bg-neutral-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-neutral-100">
        {job.lines.join('\n')}
      </pre>
      {job.error ? <Notice tone="danger">{job.error}</Notice> : null}
    </div>
  )
}

export function HarnessPairFooter({ flow }: { flow: HarnessPairingFlow }) {
  if (flow.step === 1) {
    return (
      <footer className="panel-setup-foot">
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={() => void flow.begin()}
            disabled={!flow.canContinue || flow.pending !== undefined}
            className="panel-button primary"
          >
            {flow.pending === 'create' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {flow.pending === 'create'
              ? 'Preparing…'
              : flow.installEnabled
                ? 'Install Adapter'
                : 'Continue'}
          </button>
        </div>
      </footer>
    )
  }

  if (flow.pairing && (flow.connection || flow.expired)) {
    return (
      <footer className="panel-setup-foot">
        <div className="flex w-full items-center justify-end gap-2">
          {flow.expired ? (
            <button
              type="button"
              onClick={() => void flow.startOver()}
              disabled={flow.pending !== undefined}
              className="panel-button"
            >
              Create new code
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void flow.close()}
            disabled={flow.pending !== undefined}
            className="panel-button primary"
          >
            {flow.pending === 'close' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {flow.expired ? 'Close' : 'Done'}
          </button>
        </div>
      </footer>
    )
  }

  if (flow.pairing) {
    const registry = registryCommand(flow.info, flow.pairing.kind, flow.pairing.code)
    const command = registry ?? repoCommand(flow.pairing.kind, flow.pairing.code)
    return (
      <footer className="panel-setup-foot">
        <div className="grid w-full grid-cols-2 gap-2">
          <CopyButton
            value={flow.pairing.code}
            label="Copy code"
            variant="block"
            onError={flow.reportError}
          />
          <CopyButton
            value={command}
            label="Copy command"
            variant="block"
            onError={flow.reportError}
          />
        </div>
      </footer>
    )
  }

  return <footer className="panel-setup-foot" />
}

function MachineChoice({
  active,
  onSelect,
  icon,
  title,
  description,
}: {
  active: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? 'border-[color:var(--panel-accent)] bg-[color:var(--panel-accent-soft)]'
          : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold">
        <span className="text-neutral-500 dark:text-neutral-400">{icon}</span>
        {title}
      </span>
      <span className="panel-muted mt-1 block text-[11px]">{description}</span>
    </button>
  )
}
