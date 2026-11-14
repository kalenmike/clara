import { useEffect, useRef, useState } from 'react'
import { Cable, Plus } from 'lucide-react'
import type {
  PanelHarness,
  PanelHarnessPairing,
  PanelHarnessPairingMutationResponse,
  PanelInstallInfo,
} from '@clara/shared-types'
import { formatRelative } from '../lib/format.ts'
import { isPairingRegistered } from '../lib/harness-pairing.ts'
import { fetchInstallInfo, registryCommand, repoCommand } from '../lib/install.ts'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { HarnessRemoteInstall } from './harness-remote-install.tsx'
import { CardBody, CollapsibleCard, CopyButton, Notice } from './primitives.tsx'

const KINDS = [
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'pi', label: 'Pi' },
]

type HarnessSetupMode = 'local' | 'docker' | 'relay'
type InstallMethod = 'ssh' | 'docker' | 'manual'

export function HarnessAddCard({
  enabled,
  installEnabled,
  relayConfigured,
  containerized,
  harnesses,
  onChanged,
  now,
  initialTransport,
  allowedTransports,
}: {
  enabled: boolean
  installEnabled: boolean
  relayConfigured: boolean
  containerized: boolean
  harnesses: PanelHarness[]
  onChanged: () => void
  now: number
  initialTransport?: HarnessSetupMode
  allowedTransports?: HarnessSetupMode[]
}) {
  const { redact } = usePeek()
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])
  const [pairing, setPairing] = useState<PanelHarnessPairing>()
  const [pending, setPending] = useState<'pair' | 'cancel'>()
  const [error, setError] = useState<string>()
  const [kind, setKind] = useState(KINDS[0].kind)
  const [method, setMethod] = useState<InstallMethod>('manual')
  const [installInfo, setInstallInfo] = useState<PanelInstallInfo>()
  const allowed = allowedTransports ?? ['docker', 'local', 'relay']
  const firstTransport =
    initialTransport && allowed.includes(initialTransport)
      ? initialTransport
      : (allowed.find((item) => item !== 'relay' || relayConfigured) ?? 'local')
  const [transport, setTransport] = useState<HarnessSetupMode>(firstTransport)

  useEffect(() => {
    if (pairing && isPairingRegistered(pairing, harnesses)) setPairing(undefined)
  }, [pairing, harnesses])

  useEffect(() => {
    if (installEnabled) return
    if (method !== 'manual') setMethod('manual')
  }, [installEnabled, method])

  useEffect(() => {
    let active = true
    void fetchInstallInfo()
      .then((info) => {
        if (active) setInstallInfo(info)
      })
      .catch(() => {
        // The manual command falls back to the repository install.
      })
    return () => {
      active = false
    }
  }, [])

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
      onChangedRef.current()
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
      onChangedRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const registry = pairing ? registryCommand(installInfo, pairing.kind, pairing.code) : undefined
  const repository = pairing ? repoCommand(pairing.kind, pairing.code) : ''

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
                value={registry ?? repository}
                label="Copy command"
                onError={(message) => setError(message)}
              />
            </div>
            {registry ? (
              <>
                <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Registry command
                </p>
                <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
                  {registry}
                </pre>
              </>
            ) : null}
            <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Repository command
            </p>
            <pre className="overflow-x-auto rounded-md bg-neutral-950 p-2 text-[11px] text-neutral-100">
              {repository}
            </pre>
            <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
              fingerprint {pairing.fingerprint} · {pairing.transport} · {pairing.wsUrl}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
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
              <div className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                Install method
                <div
                  role="tablist"
                  aria-label="Install method"
                  className="grid grid-cols-3 gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {(
                    [
                      ['ssh', 'SSH'],
                      ['docker', 'Docker'],
                      ['manual', 'Manual'],
                    ] as const
                  ).map(([value, label]) => {
                    const disabled = value !== 'manual' && !installEnabled
                    return (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={method === value}
                        disabled={disabled}
                        title={
                          disabled
                            ? 'Turn on adapter installs in Settings → Adapter downloads'
                            : undefined
                        }
                        onClick={() => {
                          setError(undefined)
                          setMethod(value)
                        }}
                        className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                          method === value
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'text-neutral-600 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                  {installEnabled
                    ? 'SSH and Docker run the registry install script on the target.'
                    : 'Install actions are off. Turn them on in Settings → Adapter downloads.'}
                </span>
              </div>
            </div>

            {method === 'manual' ? (
              <div className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800">
                <label className="grid content-start gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                  Adapter location
                  <select
                    value={transport}
                    onChange={(event) => setTransport(event.target.value as HarnessSetupMode)}
                    className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    {allowed.includes('docker') ? (
                      <option value="docker">Docker network</option>
                    ) : null}
                    {allowed.includes('local') ? (
                      <option value="local">This machine (loopback)</option>
                    ) : null}
                    {allowed.includes('relay') ? (
                      <option value="relay" disabled={!relayConfigured}>
                        Cloudflare relay
                      </option>
                    ) : null}
                  </select>
                  <span className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                    {transport === 'docker'
                      ? 'Adapter runs in a container on the clara network (ws://server:8788/ws).'
                      : transport === 'local'
                        ? 'Adapter runs on the hub host (ws://127.0.0.1:8788/ws).'
                        : 'Adapter connects through the configured Cloudflare relay.'}
                  </span>
                </label>
                <div className="flex items-end">
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
            ) : (
              <HarnessRemoteInstall
                method={method}
                kind={kind}
                harnesses={harnesses}
                relayConfigured={relayConfigured}
                containerized={containerized}
                onChanged={onChangedRef.current}
              />
            )}
          </div>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}
