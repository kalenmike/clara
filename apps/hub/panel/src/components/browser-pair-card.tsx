import { useState } from 'react'
import { ChevronDown, ExternalLink, LoaderCircle, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { PanelDevicePairing, PanelDevicePairingMutationResponse } from '@clara/shared-types'
import { formatRelative } from '../lib/format.ts'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { CardBody, CollapsibleCard, CopyButton, Notice } from './primitives.tsx'

type PairingTransport = 'relay' | 'local'

export function BrowserPairCard({
  relayConfigured,
  localAvailable,
  canPair,
  now,
  onChanged,
}: {
  relayConfigured: boolean
  localAvailable: boolean
  canPair: boolean
  now: number
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const [pairing, setPairing] = useState<PanelDevicePairing>()
  const [pending, setPending] = useState<'create' | 'cancel'>()
  const [transport, setTransport] = useState<PairingTransport>(relayConfigured ? 'relay' : 'local')
  const [error, setError] = useState<string>()
  const useLocalOnly = relayConfigured && localAvailable && transport === 'local'
  const helper = relayConfigured
    ? transport === 'relay'
      ? 'A relay code works from a phone or another network.'
      : 'A local code only works on this machine or its network.'
    : 'No relay is configured, so a local code only works on this machine or its network.'

  const create = async () => {
    setPending('create')
    setError(undefined)
    try {
      const result = await postPanel<PanelDevicePairingMutationResponse>(
        '/panel/api/v1/devices/pairings',
        { localOnly: useLocalOnly }
      )
      setPairing(result.pairing)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const cancel = async () => {
    if (!pairing) return
    setPending('cancel')
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/devices/pairings/${encodeURIComponent(pairing.id)}`)
      setPairing(undefined)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <CollapsibleCard
      title="Pair a browser"
      description="Create a one-time link, code, or QR for a browser or installed app"
      icon={<QrCode className="size-4" aria-hidden="true" />}
      defaultExpanded
    >
      <CardBody>
        {!canPair ? (
          <Notice>
            External connections are off. Turn them on from Overview before creating a pairing code.
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

        {pairing ? (
          <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold">Ready to pair</h3>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Expires {formatRelative(pairing.expiresAt, now)}. It enrolls one browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={pending !== undefined}
                className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-neutral-100"
              >
                {pending === 'cancel' ? 'Cancelling…' : 'Cancel code'}
              </button>
            </div>

            <div className="flex justify-center">
              <div className="w-fit rounded-lg bg-white p-3">
                <QRCodeSVG
                  value={pairing.link}
                  size={200}
                  level="M"
                  marginSize={1}
                  title="Clara browser pairing QR code"
                />
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {pairing.transport === 'local'
                ? 'This code connects directly to the hub, so it only works from this machine or its network.'
                : 'This code goes through the relay, so it works from another network.'}{' '}
              The code is not shown again after a page reload; create a new one if needed.
            </p>

            <details className="group rounded-md border border-neutral-200 dark:border-neutral-800">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium text-neutral-600 marker:hidden dark:text-neutral-300 [&::-webkit-details-marker]:hidden">
                Show codes
                <ChevronDown
                  className="size-3.5 shrink-0 text-neutral-400 transition group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-3 border-t border-neutral-200 p-3 dark:border-neutral-800">
                <div>
                  <div className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                    Link
                  </div>
                  <div className="mt-1 break-all rounded-md bg-neutral-100 p-2 font-mono text-[11px] dark:bg-neutral-900">
                    {pairing.link}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <CopyButton value={pairing.link} label="Copy link" />
                    <a
                      href={pairing.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      Open link
                    </a>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                    Code
                  </div>
                  <div className="mt-1 break-all rounded-md bg-neutral-100 p-2 font-mono text-[11px] dark:bg-neutral-900">
                    {pairing.code}
                  </div>
                  <div className="mt-2">
                    <CopyButton value={pairing.code} label="Copy code" />
                  </div>
                </div>

                <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                  fingerprint {pairing.fingerprint} · {pairing.transport} · {pairing.wsUrl}
                </p>
              </div>
            </details>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
                role="group"
                aria-label="Connection type"
              >
                <TransportButton
                  active={transport === 'relay'}
                  disabled={!relayConfigured}
                  onClick={() => setTransport('relay')}
                >
                  Relay
                </TransportButton>
                <TransportButton
                  active={transport === 'local'}
                  disabled={!localAvailable}
                  onClick={() => setTransport('local')}
                >
                  Local
                </TransportButton>
              </div>
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{helper}</span>
            </div>
            <div>
              <button
                type="button"
                onClick={() => void create()}
                disabled={!canPair || pending !== undefined}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-950"
              >
                {pending === 'create' ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <QrCode className="size-3.5" aria-hidden="true" />
                )}
                {pending === 'create' ? 'Preparing…' : 'Create pairing link'}
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </CollapsibleCard>
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
          ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
          : 'text-neutral-600 enabled:cursor-pointer enabled:hover:bg-neutral-100 dark:text-neutral-300 dark:enabled:hover:bg-neutral-800'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
