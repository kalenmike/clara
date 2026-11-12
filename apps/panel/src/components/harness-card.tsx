import { useState } from 'react'
import { Cable, Check, Copy, FlaskConical, Plus, Trash2 } from 'lucide-react'
import type {
  PanelHarness,
  PanelHarnessMutationResponse,
  PanelHarnessPairing,
  PanelHarnessPairingMutationResponse,
  PanelHarnessState,
  PanelHarnessTestResult,
} from '@clara/shared-types'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { formatRelative, formatTimestamp } from '../lib/format.ts'
import { harnessState } from '../lib/harness-state.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, Notice } from './primitives.tsx'

const KINDS = [{ kind: 'opencode', label: 'OpenCode' }]

export function HarnessCard({
  harness,
  harnesses,
  enabled,
  relayConfigured,
  onChanged,
  now,
}: {
  harness: PanelHarnessState
  harnesses: PanelHarness[]
  enabled: boolean
  relayConfigured: boolean
  onChanged: () => void
  now: number
}) {
  const { masked, redact } = usePeek()
  const [pairing, setPairing] = useState<PanelHarnessPairing>()
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const [test, setTest] = useState<PanelHarnessTestResult>()
  const [kind, setKind] = useState(KINDS[0].kind)
  const [transport, setTransport] = useState<'local' | 'docker' | 'relay'>('docker')

  const add = async () => {
    setPending('pair')
    setError(undefined)
    setTest(undefined)
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

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError('Could not copy to the clipboard')
    }
  }

  const runTest = async (connection: PanelHarness) => {
    setPending(`test:${connection.id}`)
    setError(undefined)
    setTest(undefined)
    try {
      const result = await postPanel<PanelHarnessTestResult>(
        `/panel/api/v1/harnesses/${connection.id}/test`,
        {}
      )
      setTest(result)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const activate = async (connection: PanelHarness) => {
    setPending(`activate:${connection.id}`)
    setError(undefined)
    try {
      await postPanel<PanelHarnessMutationResponse>(
        `/panel/api/v1/harnesses/${connection.id}/activate`,
        {}
      )
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const remove = async (connection: PanelHarness, forget = false) => {
    const message = forget
      ? `Forget "${connection.label}" and its Clara session metadata?`
      : `Delete the "${connection.label}" connection? Its identity and metadata are kept.`
    if (!window.confirm(message)) return
    setPending(`delete:${connection.id}`)
    setError(undefined)
    try {
      if (forget) {
        await postPanel(`/panel/api/v1/harnesses/${connection.id}/forget`, {})
      } else {
        await deletePanel(`/panel/api/v1/harnesses/${connection.id}`)
      }
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const disabled = pending !== undefined
  const command = pairing ? `pnpm clara adapter install --opencode --pair ${pairing.code}` : ''

  return (
    <CollapsibleCard
      title="Harness adapters"
      description="Adapters connect out to the hub like a paired browser"
      icon={<Cable className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={!enabled ? 'neutral' : harness.configured ? 'success' : 'warning'}>
          {!enabled ? 'Off' : harness.configured ? 'Configured' : 'Not configured'}
        </Badge>
      }
      defaultExpanded
    >
      <CardBody>
        {!enabled ? (
          <Notice tone="warning">
            The Harness switch is off. Adapters keep their credentials, but the hub does not proxy
            to them until the switch is on again.
          </Notice>
        ) : null}
        {harness.error ? <Notice tone="danger">{redact(harness.error)}</Notice> : null}
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
        {test ? (
          <Notice tone={test.ok ? 'warning' : 'danger'}>
            {test.ok
              ? `Connection ok${test.version ? ` · ${test.version}` : ''} · ${test.latencyMs} ms`
              : redact(`${test.message ?? test.code}${test.status ? ` (${test.status})` : ''}`)}
          </Notice>
        ) : null}

        {harnesses.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No adapter is paired yet. Choose a type, copy the pairing code, and run the install
            command on the machine that runs the harness.
          </p>
        ) : (
          <div className="space-y-2">
            {harnesses.map((connection) => {
              const status = harnessState(connection, enabled)
              return (
                <div
                  key={connection.id}
                  className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {connection.label}
                        {connection.isActive ? (
                          <Badge tone={enabled ? 'success' : 'neutral'}>Active</Badge>
                        ) : null}
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                        {connection.kind} · {connection.transport} ·{' '}
                        {masked ? PEEK_MASK : connection.harnessId.slice(0, 12)}
                        {connection.harnessVersion ? ` · ${connection.harnessVersion}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!connection.isActive ? (
                        <button
                          type="button"
                          onClick={() => void activate(connection)}
                          disabled={disabled}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        >
                          <Check className="size-3" aria-hidden="true" />
                          Activate
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void runTest(connection)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                      >
                        <FlaskConical className="size-3" aria-hidden="true" />
                        {pending === `test:${connection.id}` ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(connection)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="size-3" aria-hidden="true" />
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(connection, true)}
                        disabled={disabled}
                        className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                  {connection.lastTestAt ? (
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      Last test {formatRelative(connection.lastTestAt, now)} ·{' '}
                      <span title={formatTimestamp(connection.lastTestAt)}>
                        {connection.lastTestOk
                          ? 'ok'
                          : redact(connection.lastTestError ?? 'failed')}
                      </span>
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {pairing ? (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">Pair {pairing.label}</h3>
              <button
                type="button"
                onClick={() => void cancelPairing()}
                className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
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
              <button
                type="button"
                onClick={() => void copy(pairing.code)}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium dark:border-neutral-700"
              >
                <Copy className="size-3" aria-hidden="true" /> Copy code
              </button>
              <button
                type="button"
                onClick={() => void copy(command)}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium dark:border-neutral-700"
              >
                <Copy className="size-3" aria-hidden="true" /> Copy command
              </button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
              {command}
            </pre>
            <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              fingerprint {pairing.fingerprint} · {pairing.transport} · {pairing.wsUrl}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Harness type
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="mt-1 block rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                {KINDS.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Adapter location
              <select
                value={transport}
                onChange={(event) =>
                  setTransport(event.target.value as 'local' | 'docker' | 'relay')
                }
                className="mt-1 block rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="docker">Docker network (default)</option>
                <option value="local">This machine (loopback)</option>
                <option value="relay" disabled={!relayConfigured}>
                  Cloudflare relay
                </option>
              </select>
              <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                {transport === 'docker'
                  ? 'Adapter runs in a container on the clara network (ws://server:8788/ws).'
                  : transport === 'local'
                    ? 'Adapter runs on the hub host (ws://127.0.0.1:8788/ws).'
                    : 'Adapter connects through the configured Cloudflare relay.'}
              </span>
            </label>
            <button
              type="button"
              onClick={() => void add()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {pending === 'pair' ? 'Preparing…' : 'Add harness'}
            </button>
          </div>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}
