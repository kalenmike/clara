import type { ReactNode } from 'react'
import { Check, ExternalLink, Globe2, LoaderCircle, Wifi, X } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Input } from '@clara/ui/components/input'
import { Select, SelectItem, SelectTrigger, SelectValue } from '@clara/ui/components/select'
import {
  harnessHostSummary,
  type AdapterInstallJob,
  type AdapterInstallOffer,
} from '@clara/shared-types'
import { HARNESS_KINDS } from '../lib/harness-pairing.ts'
import { formatRelative } from '../lib/format.ts'
import { MANUAL_SSH_HOST, type HarnessPairingFlow } from '../lib/use-harness-pairing.ts'
import { HarnessSelectContent } from './harness-select-portal.tsx'
import { Badge, CopyButton, Notice, Toggle } from './primitives.tsx'

const DETAIL_LABEL = 'text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'
const DETAIL_CODE = 'block break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground'

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
        <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
          Harnesses
        </div>
        <h2 id="panel-harness-pair-title" className="mt-0.5 text-base font-semibold">
          Pair a harness
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Pair an adapter from the machine that runs the harness
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close harness pairing"
        disabled={pending !== undefined}
        className="shrink-0"
      >
        {pending === 'close' ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-4" aria-hidden="true" />
        )}
      </Button>
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
      <HarnessCards flow={flow} />
      {flow.adapterHost && flow.machine === 'remote' ? <SshHostField flow={flow} /> : null}
      <AdvancedFields flow={flow} />
    </div>
  )
}

function HarnessCards({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-foreground">Harness</p>
      <div role="radiogroup" aria-label="Harness" className="mt-2 grid gap-2 sm:grid-cols-3">
        {HARNESS_KINDS.map((item) => {
          const active = flow.kind === item.kind
          return (
            <button
              key={item.kind}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => flow.setKind(item.kind)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition ${
                active ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
              }`}
            >
              <span className="text-[11px] font-semibold text-foreground">{item.label}</span>
              {active ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AdvancedFields({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <details className="rounded-lg border border-border px-3 py-2.5">
      <summary className="cursor-pointer text-[11px] font-medium text-foreground">Advanced</summary>
      <div className="mt-3 space-y-3">
        <HarnessLocationFields flow={flow} />
        <ConnectionModeFields flow={flow} />
        {flow.connectionMode === 'direct' ? (
          <WebSocketField flow={flow} required={flow.needsAddress} />
        ) : null}
        {flow.kind === 'opencode' ? <OpenCodeUrlField flow={flow} /> : null}
        {flow.transportNotice ? <Notice>{flow.transportNotice}</Notice> : null}
      </div>
    </details>
  )
}

function HarnessLocationFields({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <FieldGroup label="Harness location">
      <div role="radiogroup" aria-label="Harness location" className="grid gap-2 sm:grid-cols-2">
        <Choice
          active={flow.machine === 'local'}
          onSelect={() => flow.setMachine('local')}
          icon={<Wifi className="size-4" aria-hidden="true" />}
          title="Local machine"
          description="This machine, either directly or inside one of its Docker containers."
        />
        <Choice
          active={flow.machine === 'remote'}
          onSelect={() => flow.setMachine('remote')}
          icon={<Globe2 className="size-4" aria-hidden="true" />}
          title="Remote host"
          description="Another machine, installed over SSH or with a command you copy."
        />
      </div>
      {flow.machine === 'local' ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
            <span className="text-[11px] font-medium text-foreground">
              Harness runs inside a Docker container
            </span>
            <Toggle
              checked={flow.target === 'container'}
              onChange={() => flow.setTarget(flow.target === 'container' ? 'host' : 'container')}
              label="Harness runs inside a Docker container"
            />
          </div>
          {flow.target === 'container' ? <ContainerField flow={flow} /> : null}
        </div>
      ) : null}
    </FieldGroup>
  )
}

function ConnectionModeFields({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <FieldGroup label="Connection mode">
      <div role="radiogroup" aria-label="Connection mode" className="grid gap-2 sm:grid-cols-2">
        <Choice
          active={flow.connectionMode === 'relay'}
          onSelect={() => flow.setConnectionMode('relay')}
          icon={<Globe2 className="size-4" aria-hidden="true" />}
          title="Relay"
          description="Works from any network. Needs a configured relay."
        />
        <Choice
          active={flow.connectionMode === 'direct'}
          onSelect={() => flow.setConnectionMode('direct')}
          icon={<Wifi className="size-4" aria-hidden="true" />}
          title="Direct"
          description="A WebSocket address the harness machine can reach."
        />
      </div>
    </FieldGroup>
  )
}

function OpenCodeUrlField({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-foreground">
      OpenCode URL <span className="font-normal text-muted-foreground">(optional)</span>
      <Input
        value={flow.opencodeUrl}
        onChange={(event) => flow.setOpencodeUrl(event.target.value)}
        placeholder="http://127.0.0.1:4096"
        spellCheck={false}
        className="font-mono text-xs"
      />
      <span className="text-[10px] font-normal text-muted-foreground">
        Set this when the installer cannot discover OpenCode on the harness machine.
      </span>
    </label>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      <div className="mt-2">{children}</div>
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

function SshHostField({ flow }: { flow: HarnessPairingFlow }) {
  const manual = flow.sshHost === MANUAL_SSH_HOST
  return (
    <div className="space-y-2">
      {flow.targetsError ? <Notice>{flow.targetsError}</Notice> : null}
      {flow.sshError ? <Notice>{flow.sshError}</Notice> : null}
      <label className="grid gap-1 text-[11px] font-medium text-foreground">
        SSH host
        <Select value={flow.sshHost} onValueChange={flow.setSshHost}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a host from ~/.ssh/config" />
          </SelectTrigger>
          <HarnessSelectContent>
            {flow.sshHosts.map((item) => (
              <SelectItem key={item.alias} value={item.alias}>
                {item.alias} — {item.user ? `${item.user}@` : ''}
                {item.hostname}
              </SelectItem>
            ))}
            <SelectItem value={MANUAL_SSH_HOST}>Enter manually…</SelectItem>
          </HarnessSelectContent>
        </Select>
      </label>
      {manual ? (
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={flow.sshHostname}
            onChange={(event) => flow.setSshHostname(event.target.value)}
            placeholder="server.example"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <Input
            value={flow.sshUser}
            onChange={(event) => flow.setSshUser(event.target.value)}
            placeholder="user"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <Input
            value={flow.sshPort}
            onChange={(event) => flow.setSshPort(event.target.value)}
            placeholder="22"
            inputMode="numeric"
            className="font-mono text-xs"
          />
        </div>
      ) : null}
    </div>
  )
}

function ContainerField({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <div className="space-y-2">
      {flow.targetsError ? <Notice>{flow.targetsError}</Notice> : null}
      {flow.dockerError ? <Notice>{flow.dockerError}</Notice> : null}
      <label className="grid gap-1 text-[11px] font-medium text-foreground">
        Container
        <Select value={flow.container} onValueChange={flow.setContainer}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a running container" />
          </SelectTrigger>
          <HarnessSelectContent>
            {flow.containers.map((item) => (
              <SelectItem key={item.id} value={item.name}>
                {item.name} — {item.image}
              </SelectItem>
            ))}
          </HarnessSelectContent>
        </Select>
      </label>
    </div>
  )
}

function WebSocketField({
  flow,
  required = false,
}: {
  flow: HarnessPairingFlow
  required?: boolean
}) {
  const candidates = flow.addressCandidates
  return (
    <label className="grid gap-1 text-[11px] font-medium text-foreground">
      WebSocket URL
      {required ? (
        <span className="font-normal text-amber-600 dark:text-amber-400">required</span>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={flow.wsUrl}
          onChange={(event) => flow.setWsUrl(event.target.value)}
          placeholder={flow.defaultWsUrl}
          spellCheck={false}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        {candidates.length > 0 ? (
          <Select onValueChange={flow.setWsUrl}>
            <SelectTrigger className="max-w-[45%]" aria-label="Use a detected address">
              <SelectValue placeholder="Detected…" />
            </SelectTrigger>
            <HarnessSelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.url} value={candidate.url}>
                  {candidateLabel(candidate.scope)} · {candidate.url}
                </SelectItem>
              ))}
            </HarnessSelectContent>
          </Select>
        ) : null}
      </div>
      <span className="text-[10px] font-normal text-muted-foreground">
        {required
          ? 'Enter an address the harness machine can reach. A Docker container usually uses the Docker bridge or the host LAN address; another machine uses the hub LAN address or a tunnel.'
          : 'Leave blank to use the hub default for the chosen target. Set it when the adapter reaches the hub at another address, for example over a LAN or SSH tunnel.'}
      </span>
    </label>
  )
}

function candidateLabel(scope: string): string {
  if (scope === 'docker') return 'Docker'
  if (scope === 'lan') return 'LAN'
  return 'Loopback'
}

function OfferStep({ flow, now }: { flow: HarnessPairingFlow; now: number }) {
  const offer = flow.offer
  if (!offer) return null
  const harnessLabel =
    HARNESS_KINDS.find((item) => item.kind === offer.pairing.kind)?.label ?? offer.pairing.label
  const connectionLabel = offer.pairing.transport === 'relay' ? 'Relay' : 'Direct'

  return (
    <div className="space-y-4">
      {flow.imported && flow.adapterHost ? <ImportedTargetPicker flow={flow} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-foreground">
          {harnessLabel}
          <span className="mx-1 text-muted-foreground">·</span>
          {connectionLabel}
        </p>
        {flow.imported ? <Badge tone="neutral">From link</Badge> : null}
      </div>

      {flow.adapterHost && offer.manifest ? <InstallButton flow={flow} /> : null}

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
              {harnessHostSummary(flow.connection.host)
                ? ` on ${harnessHostSummary(flow.connection.host)}`
                : ''}
            </>
          ) : (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Waiting for the adapter to connect…
            </>
          )}
        </p>
      </div>

      {!flow.adapterHost ? (
        <a
          href={offer.deepLink}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open in Clara Desktop
        </a>
      ) : null}

      {flow.expired ? (
        <Notice tone="danger">
          This pairing code expired. Create a new one to enroll the adapter.
        </Notice>
      ) : null}

      {flow.job?.state === 'failed' ? (
        <Notice tone="danger">
          {flow.job.error ?? 'The install failed. Open Pairing details for the log.'}
        </Notice>
      ) : null}

      <PairingDetails flow={flow} offer={offer} />
    </div>
  )
}

function ImportedTargetPicker({ flow }: { flow: HarnessPairingFlow }) {
  return (
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
      {flow.machine === 'remote' ? (
        <SshHostField flow={flow} />
      ) : flow.target === 'container' ? (
        <ContainerField flow={flow} />
      ) : null}
    </div>
  )
}

function InstallButton({ flow }: { flow: HarnessPairingFlow }) {
  const phrase = installTargetPhrase(flow)
  const installing =
    flow.pending === 'create' || flow.pending === 'install' || flow.job?.state === 'running'
  const installed = flow.job?.state === 'succeeded'
  const failed = flow.job?.state === 'failed' || flow.job?.state === 'cancelled'

  return (
    <Button
      type="button"
      onClick={() => void flow.install()}
      disabled={
        installing || installed || flow.pending !== undefined || !flow.canInstall || flow.expired
      }
      className="w-full justify-center"
    >
      {installing ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      ) : installed ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : null}
      {installing
        ? `Installing ${phrase}`
        : installed
          ? `Installed ${phrase}`
          : failed
            ? `Retry install ${phrase}`
            : `Install ${phrase}`}
    </Button>
  )
}

function PairingDetails({ flow, offer }: { flow: HarnessPairingFlow; offer: AdapterInstallOffer }) {
  return (
    <details className="rounded-lg border border-border px-3 py-2.5">
      <summary className="cursor-pointer text-[11px] font-medium text-foreground">
        Pairing details
      </summary>
      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <p className={DETAIL_LABEL}>Connects to</p>
          <code className={DETAIL_CODE}>{offer.pairing.wsUrl}</code>
        </div>
        <div className="space-y-1">
          <p className={DETAIL_LABEL}>Pairing code</p>
          <code className={DETAIL_CODE}>{offer.pairing.code}</code>
        </div>
        {offer.command ? (
          <div className="space-y-1">
            <p className={DETAIL_LABEL}>Install command</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px] text-foreground">
              {offer.command}
            </pre>
          </div>
        ) : null}
        {flow.job ? <JobLog job={flow.job} onCancel={() => void flow.cancelInstall()} /> : null}
      </div>
    </details>
  )
}

function installTargetPhrase(flow: HarnessPairingFlow): string {
  if (flow.machine === 'remote') return 'via SSH'
  return flow.target === 'container' ? 'in Docker' : 'on this computer'
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
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <pre className="max-h-40 overflow-auto rounded-md bg-neutral-950 p-2 text-[11px] whitespace-pre-wrap text-neutral-100">
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
          <Button
            type="button"
            onClick={() => void flow.begin()}
            disabled={!flow.canContinue || flow.pending !== undefined}
          >
            {flow.pending === 'create' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {flow.pending === 'create' ? 'Preparing…' : 'Create code'}
          </Button>
        </div>
      </footer>
    )
  }

  if (flow.pairing && (flow.connection || flow.expired)) {
    return (
      <footer className="panel-setup-foot">
        <div className="flex w-full items-center justify-end gap-2">
          {flow.expired ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void flow.startOver()}
              disabled={flow.pending !== undefined}
            >
              Create new code
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => void flow.close()}
            disabled={flow.pending !== undefined}
          >
            {flow.pending === 'close' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {flow.expired ? 'Close' : 'Done'}
          </Button>
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
