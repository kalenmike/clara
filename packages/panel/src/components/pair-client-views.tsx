import { Check, LoaderCircle, QrCode, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { PanelDevicePairing } from '@clara/shared-types'
import type { BrowserPairingConnection } from '../lib/browser-pairing.ts'
import { formatRelative } from '../lib/format.ts'
import { usePeek } from '../lib/peek-context.tsx'
import type { ClientPairingFlow } from '../lib/use-client-pairing.ts'
import { CopyButton, Notice } from './primitives.tsx'

export function PairClientHeader({
  pending,
  onClose,
}: {
  pending: ClientPairingFlow['pending']
  onClose: () => void
}) {
  return (
    <header className="panel-setup-head">
      <div className="min-w-0">
        <div className="panel-muted text-[10px] font-semibold tracking-[0.08em] uppercase">
          Clients
        </div>
        <h2 id="panel-pair-title" className="mt-0.5 text-base font-semibold">
          Pair a client
        </h2>
        <p className="panel-muted mt-1 text-xs">
          Create a one-time link, code, or QR for a browser or installed app
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close pairing dialog"
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

export function PairClientSetupView({ flow }: { flow: ClientPairingFlow }) {
  return (
    <div className="space-y-4">
      {flow.notice ? <Notice>{flow.notice}</Notice> : null}
      <div>
        <div
          className="inline-flex rounded-md border border-border p-0.5"
          role="group"
          aria-label="Connection type"
        >
          <TransportButton
            active={flow.transport === 'relay'}
            disabled={!flow.relayUsable}
            onClick={() => flow.setTransport('relay')}
          >
            Relay
          </TransportButton>
          <TransportButton
            active={flow.transport === 'local'}
            disabled={!flow.localAvailable}
            onClick={() => flow.setTransport('local')}
          >
            Local
          </TransportButton>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{flow.helper}</p>
      </div>
    </div>
  )
}

export function PairClientContent({ flow, now }: { flow: ClientPairingFlow; now: number }) {
  const { redact } = usePeek()

  return (
    <div className="space-y-3">
      {flow.error ? <Notice tone="danger">{redact(flow.error)}</Notice> : null}
      {flow.pairing ? (
        <PairClientPairingView
          pairing={flow.pairing}
          connection={flow.connection}
          expired={flow.expired}
          now={now}
        />
      ) : (
        <PairClientSetupView flow={flow} />
      )}
    </div>
  )
}

export function PairClientPairingView({
  pairing,
  connection,
  expired,
  now,
}: {
  pairing: PanelDevicePairing
  connection?: BrowserPairingConnection
  expired: boolean
  now: number
}) {
  if (expired) {
    return <Notice>This pairing link expired. Create a new one to enroll a client.</Notice>
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="w-fit max-w-full rounded-lg bg-white p-3">
        <QRCodeSVG
          value={pairing.link}
          size={288}
          level="L"
          marginSize={2}
          className="h-auto max-w-full"
          title="Clara browser pairing QR code"
        />
      </div>
      <a href={pairing.link} target="_blank" rel="noreferrer" className="panel-link text-xs">
        Open Link
      </a>
      <p className="text-[11px] text-muted-foreground">
        Expires {formatRelative(pairing.expiresAt, now)}. It enrolls one client.
      </p>
      <p
        className={`flex items-center gap-1.5 text-xs ${
          connection
            ? 'font-medium text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground'
        }`}
      >
        {connection ? (
          <>
            <Check className="size-3.5" aria-hidden="true" />
            Connected
            {connection.label ? ` · ${connection.label}` : null}
          </>
        ) : (
          <>
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            Waiting to connect…
          </>
        )}
      </p>
    </div>
  )
}

export function PairClientFooter({ flow }: { flow: ClientPairingFlow }) {
  if (flow.pairing) {
    if (flow.connection || flow.expired) {
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
                Create new link
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
            value={flow.pairing.link}
            label="Copy link"
            variant="block"
            onError={flow.reportError}
          />
        </div>
      </footer>
    )
  }

  return (
    <footer className="panel-setup-foot">
      <div className="flex w-full justify-end">
        <button
          type="button"
          onClick={() => void flow.create()}
          disabled={!flow.canPair || flow.pending !== undefined}
          className="panel-button primary"
        >
          {flow.pending === 'create' ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <QrCode className="size-3.5" aria-hidden="true" />
          )}
          {flow.pending === 'create' ? 'Preparing…' : 'Create pairing link'}
        </button>
      </div>
    </footer>
  )
}

function TransportButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground enabled:cursor-pointer enabled:hover:bg-accent'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
