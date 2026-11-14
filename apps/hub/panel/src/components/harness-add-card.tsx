import { useEffect, useState } from 'react'
import { Cable, Plus } from 'lucide-react'
import type {
  PanelHarness,
  PanelHarnessPairing,
  PanelHarnessPairingMutationResponse,
} from '@clara/shared-types'
import { formatRelative } from '../lib/format.ts'
import { isPairingRegistered } from '../lib/harness-pairing.ts'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { CardBody, CollapsibleCard, CopyButton, Notice } from './primitives.tsx'

const KINDS = [
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'claude', label: 'Claude Code' },
]

type HarnessSetupMode = 'local' | 'docker' | 'relay'

export function HarnessAddCard({
  enabled,
  relayConfigured,
  harnesses,
  onChanged,
  now,
}: {
  enabled: boolean
  relayConfigured: boolean
  harnesses: PanelHarness[]
  onChanged: () => void
  now: number
}) {
  const { redact } = usePeek()
  const [pairing, setPairing] = useState<PanelHarnessPairing>()
  const [pending, setPending] = useState<'pair' | 'cancel'>()
  const [error, setError] = useState<string>()
  const [kind, setKind] = useState(KINDS[0].kind)
  const [transport, setTransport] = useState<HarnessSetupMode>('docker')

  useEffect(() => {
    if (pairing && isPairingRegistered(pairing, harnesses)) setPairing(undefined)
  }, [pairing, harnesses])

  const add = async () => {
    setPending('pair')
    setError(undefined)
    try {
      const result = await postPanel<PanelHarnessPairingMutationResponse>(
        '/panel/api/v1/harnesses/pairings',
        {
          kind,
          label: KINDS.find((item) => item.kind === kind)?.label ?? kind,
          transport,
        }
      )
      setPairing(result.pairing)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const cancelPairing = async () => {
    if (!pairing) return
    setPending('cancel')
    try {
      await deletePanel(`/panel/api/v1/harnesses/pairings/${pairing.id}`)
      setPairing(undefined)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const command = pairing
    ? `pnpm clara adapter install --${pairing.kind} --pair ${pairing.code}`
    : ''

  return (
    <CollapsibleCard
      title="Add harness"
      description="Pair an adapter from the machine that runs the harness"
      icon={<Plus className="size-4" aria-hidden="true" />}
      defaultExpanded
    >
      <CardBody>
        {!enabled ? (
          <Notice tone="warning">
            Harness access is off. Adapters keep their credentials, but the hub does not proxy to
            them until harness access is on again.
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

        {pairing ? (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">Pair {pairing.label}</h3>
              <button
                type="button"
                onClick={() => void cancelPairing()}
                disabled={pending !== undefined}
                className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-neutral-100"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              On the harness machine, install the adapter and paste this code. It expires{' '}
              {formatRelative(pairing.expiresAt, now)}.
            </p>
            <div className="rounded-md bg-neutral-100 p-2 font-mono text-[11px] break-all dark:bg-neutral-900">
              {pairing.code}
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton
                value={pairing.code}
                label="Copy code"
                onError={(message) => setError(message)}
              />
              <CopyButton
                value={command}
                label="Copy command"
                onError={(message) => setError(message)}
              />
            </div>
            <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
              {command}
            </pre>
            <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              fingerprint {pairing.fingerprint} · {pairing.transport} · {pairing.wsUrl}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800">
            <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Harness
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                {KINDS.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Adapter location
              <select
                value={transport}
                onChange={(event) => setTransport(event.target.value as HarnessSetupMode)}
                className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="docker">Docker network (default)</option>
                <option value="local">This machine (loopback)</option>
                <option value="relay" disabled={!relayConfigured}>
                  Cloudflare relay
                </option>
              </select>
              <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                {transport === 'docker'
                  ? 'Adapter runs in a container on the clara network (ws://server:8788/ws).'
                  : transport === 'local'
                    ? 'Adapter runs on the hub host (ws://127.0.0.1:8788/ws).'
                    : 'Adapter connects through the configured Cloudflare relay.'}
              </span>
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => void add()}
                disabled={pending !== undefined}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-950"
              >
                <Cable className="size-3.5" aria-hidden="true" />
                {pending === 'pair' ? 'Preparing…' : 'Add harness'}
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}
