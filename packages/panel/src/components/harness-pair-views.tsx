import { Check, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { HARNESS_KINDS } from '../lib/harness-pairing.ts'
import { formatRelative } from '../lib/format.ts'
import type { HarnessPairingFlow } from '../lib/use-harness-pairing.ts'
import { CopyButton, Notice } from './primitives.tsx'

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
          Issue a one-time code for the machine that runs the harness
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
      {flow.step === 1 ? <KindStep flow={flow} /> : <OfferStep flow={flow} now={now} />}
    </div>
  )
}

function KindStep({ flow }: { flow: HarnessPairingFlow }) {
  return (
    <div className="space-y-4">
      <label className="grid gap-1 text-[11px] font-medium text-foreground">
        Harness
        <select
          value={flow.kind}
          onChange={(event) => flow.setKind(event.target.value)}
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs "
        >
          {HARNESS_KINDS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {flow.kind === 'opencode' ? (
        <label className="grid gap-1 text-[11px] font-medium text-foreground">
          OpenCode URL <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            value={flow.opencodeUrl}
            onChange={(event) => flow.setOpencodeUrl(event.target.value)}
            placeholder="http://127.0.0.1:4096"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px] "
          />
          <span className="text-[10px] font-normal text-muted-foreground">
            Set this when the installer cannot discover OpenCode on the harness machine.
          </span>
        </label>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        The hub issues the code and the install command. Run the command on the machine that hosts
        the harness, or open the link with Clara Desktop to install it in one click.
      </p>
    </div>
  )
}

function OfferStep({ flow, now }: { flow: HarnessPairingFlow; now: number }) {
  const offer = flow.offer
  if (!offer) return null
  const command = offer.command

  return (
    <div className="space-y-4">
      <div>
        <span className="inline-flex rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
          {offer.pairing.kind}
        </span>
      </div>

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

      <a
        href={offer.deepLink}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
        Open in Clara Desktop
      </a>

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
