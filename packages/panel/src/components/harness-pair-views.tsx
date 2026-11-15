import type { ReactNode } from 'react'
import { Check, ExternalLink, Globe2, LoaderCircle, Wifi, X } from 'lucide-react'
import type { AdapterInstallJob } from '@clara/shared-types'
import { HARNESS_KINDS } from '../lib/harness-pairing.ts'
import { formatRelative } from '../lib/format.ts'
import { MANUAL_SSH_HOST, type HarnessPairingFlow } from '../lib/use-harness-pairing.ts'
import { Badge, CopyButton, Notice } from './primitives.tsx'

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
      {flow.step === 1 ? <SetupStep flow={flow} /> : <OfferStep flow={flow} now={now} />}
    </div>
  )
}

function SetupStep({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <div className="space-y-4">
      <label className="grid gap-1 text-[11px] font-medium text-foreground">
        Harness
        <select
          value={flow.kind}
          onChange={(event) => flow.setKind(event.target.value)}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
        >
          {HARNESS_KINDS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="text-[11px] font-medium text-foreground">
          On which machine is your harness running?
        </p>
        <div
          role="radiogroup"
          aria-label="Harness machine"
          className="mt-2 grid gap-2 sm:grid-cols-2"
        >
          <Choice
            active={flow.machine === 'remote'}
            onSelect={() => flow.setMachine('remote')}
            icon={<Globe2 className="size-4" aria-hidden="true" />}
            title="Remote"
            description="Another machine, installed over SSH or with a command you copy."
          />
          <Choice
            active={flow.machine === 'local'}
            onSelect={() => flow.setMachine('local')}
            icon={<Wifi className="size-4" aria-hidden="true" />}
            title="Local"
            description="This machine, either directly or inside one of its Docker containers."
          />
        </div>
      </div>

      {flow.machine === 'local' ? (
        <div>
          <p className="text-[11px] font-medium text-foreground">Where does the adapter run?</p>
          <div
            role="radiogroup"
            aria-label="Local harness target"
            className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1"
          >
            {(
              [
                ['host', 'This machine'],
                ['container', 'Docker container'],
              ] as const
            ).map(([target, label]) => (
              <button
                key={target}
                type="button"
                role="radio"
                aria-checked={flow.target === target}
                onClick={() => flow.setTarget(target)}
                className={`cursor-pointer rounded px-2 py-1.5 text-[11px] font-medium transition ${
                  flow.target === target
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <InstallTargetFields flow={flow} />

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-[11px] font-medium text-foreground">
          Advanced
        </summary>
        <label className="mt-2 grid gap-1 text-[11px] font-medium text-foreground">
          WebSocket URL
          <input
            value={flow.wsUrl}
            onChange={(event) => flow.setWsUrl(event.target.value)}
            placeholder={flow.defaultWsUrl}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
          />
          <span className="text-[10px] font-normal text-muted-foreground">
            Leave blank to use the hub&apos;s default address for the chosen target. Set it when the
            adapter reaches the hub at another address, for example over a LAN or SSH tunnel.
          </span>
        </label>
      </details>

      {flow.kind === 'opencode' ? (
        <label className="grid gap-1 text-[11px] font-medium text-foreground">
          OpenCode URL <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            value={flow.opencodeUrl}
            onChange={(event) => flow.setOpencodeUrl(event.target.value)}
            placeholder="http://127.0.0.1:4096"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
          />
          <span className="text-[10px] font-normal text-muted-foreground">
            Set this when the installer cannot discover OpenCode on the harness machine.
          </span>
        </label>
      ) : null}

      {flow.transportNotice ? <Notice>{flow.transportNotice}</Notice> : null}

      <p className="text-[11px] text-muted-foreground">
        {flow.adapterHost
          ? 'The code is created first. Then install it here, or copy the command for another machine.'
          : 'The hub issues the code and the install command. Run the command on the machine that hosts the harness, or open the link with Clara Desktop to install it in one click.'}
      </p>
    </div>
  )
}

function Choice({
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
      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-left transition ${
        active ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
      }`}
    >
      <span className="mt-0.5 text-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-[10px] text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function InstallTargetFields({ flow }: { flow: HarnessPairingFlow }) {
  if (!flow.adapterHost) return null

  if (flow.machine === 'remote') {
    const manual = flow.sshHost === MANUAL_SSH_HOST
    return (
      <div className="space-y-2">
        {flow.targetsError ? <Notice>{flow.targetsError}</Notice> : null}
        <label className="grid gap-1 text-[11px] font-medium text-foreground">
          Host
          <select
            value={flow.sshHost}
            onChange={(event) => flow.setSshHost(event.target.value)}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            <option value="">Choose a host from ~/.ssh/config</option>
            {flow.sshHosts.map((item) => (
              <option key={item.alias} value={item.alias}>
                {item.alias} — {item.user ? `${item.user}@` : ''}
                {item.hostname}
              </option>
            ))}
            <option value={MANUAL_SSH_HOST}>Enter manually…</option>
          </select>
        </label>
        {manual ? (
          <div className="grid grid-cols-3 gap-2">
            <input
              value={flow.sshHostname}
              onChange={(event) => flow.setSshHostname(event.target.value)}
              placeholder="server.example"
              spellCheck={false}
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
            />
            <input
              value={flow.sshUser}
              onChange={(event) => flow.setSshUser(event.target.value)}
              placeholder="user"
              spellCheck={false}
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
            />
            <input
              value={flow.sshPort}
              onChange={(event) => flow.setSshPort(event.target.value)}
              placeholder="22"
              inputMode="numeric"
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
            />
          </div>
        ) : null}
      </div>
    )
  }

  if (flow.target !== 'container') return null

  return (
    <div className="space-y-2">
      {flow.targetsError ? <Notice>{flow.targetsError}</Notice> : null}
      <label className="grid gap-1 text-[11px] font-medium text-foreground">
        Container
        <select
          value={flow.container}
          onChange={(event) => flow.setContainer(event.target.value)}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">Choose a running container</option>
          {flow.containers.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name} — {item.image}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function OfferStep({ flow, now }: { flow: HarnessPairingFlow; now: number }) {
  const offer = flow.offer
  if (!offer) return null
  const command = offer.command
  const targetLabel =
    flow.machine === 'remote'
      ? 'SSH host'
      : flow.target === 'container'
        ? 'Docker container'
        : 'this computer'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
          {offer.pairing.kind}
        </span>
        <Badge tone="info">{transportLabel(offer.pairing.transport)}</Badge>
        {flow.imported ? <Badge tone="neutral">From link</Badge> : null}
      </div>

      {flow.imported && flow.adapterHost ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground">Where should the installer run?</p>
          <div
            role="radiogroup"
            aria-label="Install target"
            className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1"
          >
            {(
              [
                ['local-host', 'This machine'],
                ['local-container', 'Docker container'],
                ['remote', 'SSH host'],
              ] as const
            ).map(([value, label]) => {
              const active =
                value === 'remote'
                  ? flow.machine === 'remote'
                  : flow.machine === 'local' &&
                    flow.target === (value === 'local-container' ? 'container' : 'host')
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    if (value === 'remote') {
                      flow.setMachine('remote')
                    } else {
                      flow.setMachine('local')
                      flow.setTarget(value === 'local-container' ? 'container' : 'host')
                    }
                  }}
                  className={`cursor-pointer rounded px-2 py-1.5 text-[11px] font-medium transition ${
                    active
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <InstallTargetFields flow={flow} />
          <p className="text-[10px] text-muted-foreground">
            This code connects through the {transportLabel(offer.pairing.transport).toLowerCase()}.
            Choose a target that can reach that address.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Install on {targetLabel} with the code below.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Pairing code
        </p>
        <code className="block break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">
          {offer.pairing.code}
        </code>
      </div>

      {command ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Install command
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px] text-foreground">
            {command}
          </pre>
        </div>
      ) : null}

      {!flow.adapterHost ? (
        <a
          href={offer.deepLink}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open in Clara Desktop
        </a>
      ) : null}

      {flow.adapterHost && offer.manifest ? (
        <button
          type="button"
          onClick={() => void flow.install()}
          disabled={!flow.canInstall || flow.pending !== undefined}
          className="panel-button primary w-full justify-center"
        >
          {flow.pending === 'install' || flow.job?.state === 'running' ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          {flow.job?.state === 'running'
            ? 'Installing…'
            : flow.pending === 'install'
              ? 'Starting…'
              : `Install on ${targetLabel}`}
        </button>
      ) : null}

      {flow.job ? <JobLog job={flow.job} onCancel={() => void flow.cancelInstall()} /> : null}

      <div className="space-y-1 text-center">
        <p className="text-[11px] text-muted-foreground">
          Expires {formatRelative(offer.pairing.expiresAt, now)}. It enrolls one adapter.
        </p>
        <p
          className={`flex items-center justify-center gap-1.5 text-[11px] ${
            flow.connection
              ? 'font-medium text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground'
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
    </div>
  )
}

function JobLog({ job, onCancel }: { job: AdapterInstallJob; onCancel: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Badge
          tone={job.state === 'succeeded' ? 'success' : job.state === 'failed' ? 'danger' : 'info'}
        >
          {job.state}
        </Badge>
        {job.state === 'running' ? (
          <button type="button" onClick={onCancel} className="panel-button">
            Cancel
          </button>
        ) : null}
      </div>
      <pre className="max-h-40 overflow-auto rounded-md bg-neutral-950 p-2 text-[11px] whitespace-pre-wrap text-neutral-100">
        {job.lines.join('\n')}
      </pre>
      {job.error ? <Notice tone="danger">{job.error}</Notice> : null}
    </div>
  )
}

function transportLabel(transport: string): string {
  if (transport === 'relay') return 'Relay'
  if (transport === 'docker') return 'Docker network'
  return 'Direct'
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
            {flow.pending === 'create' ? 'Preparing…' : 'Create code'}
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

  if (flow.offer) {
    return (
      <footer className="panel-setup-foot">
        <div className="grid w-full grid-cols-2 gap-2">
          <CopyButton
            value={flow.offer.pairing.code}
            label="Copy code"
            variant="block"
            onError={flow.reportError}
          />
          <CopyButton
            value={flow.offer.command ?? flow.offer.pairing.code}
            label={flow.offer.command ? 'Copy command' : 'Copy code'}
            variant="block"
            onError={flow.reportError}
          />
        </div>
      </footer>
    )
  }

  return <footer className="panel-setup-foot" />
}
