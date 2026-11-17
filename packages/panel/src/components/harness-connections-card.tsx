import { useEffect, useState } from 'react'
import { Cable, FlaskConical, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import {
  harnessHostSummary,
  type PanelHarness,
  type PanelHarnessTestResult,
  type PanelHarnessUpdateResult,
  type PanelInstallInfo,
} from '@clara/shared-types'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { harnessState } from '../lib/harness-state.ts'
import { adapterRepairCommand, adapterUpdate, fetchInstallInfo } from '../lib/install.ts'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { Badge, CardBody, CollapsibleCard, EmptyState, Notice } from './primitives.tsx'

export function HarnessConnectionsCard({
  harnesses,
  enabled,
  onChanged,
  now,
}: {
  harnesses: PanelHarness[]
  enabled: boolean
  onChanged: () => void
  now: number
}) {
  const { masked, redact } = usePeek()
  const [pending, setPending] = useState<string>()
  const [forgetTarget, setForgetTarget] = useState<PanelHarness | null>(null)
  const [error, setError] = useState<string>()
  const [test, setTest] = useState<PanelHarnessTestResult>()
  const [installInfo, setInstallInfo] = useState<PanelInstallInfo>()
  const [updateTarget, setUpdateTarget] = useState<{
    connection: PanelHarness
    to: string
  } | null>(null)
  const [update, setUpdate] = useState<{
    id: string
    kind: string
    from: string
    to: string
    startedAt: number
  }>()
  const [updateFailure, setUpdateFailure] = useState<{ message: string; kind: string }>()

  const loadInstallInfo = async () => {
    try {
      setInstallInfo(await fetchInstallInfo())
    } catch {
      // The update action reports its own error when the registry is unavailable.
    }
  }

  useEffect(() => {
    if (!enabled) return
    void loadInstallInfo()
  }, [enabled])

  useEffect(() => {
    if (!update) return
    const connection = harnesses.find((item) => item.id === update.id)
    if (
      connection?.online &&
      connection.adapterVersion &&
      connection.adapterVersion !== update.from
    ) {
      setUpdate(undefined)
      setUpdateFailure(undefined)
    }
  }, [harnesses, update])

  useEffect(() => {
    if (!update) return
    const remaining = Math.max(0, 3 * 60_000 - (Date.now() - update.startedAt))
    const timer = window.setTimeout(() => {
      setUpdate(undefined)
      setUpdateFailure({
        message:
          'The adapter did not reconnect with the new version. Check its log or run the repair command below on the harness machine.',
        kind: harnesses.find((item) => item.id === update.id)?.kind ?? '',
      })
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [update, harnesses])

  const runUpdate = async (connection: PanelHarness) => {
    setPending(`update:${connection.id}`)
    setUpdateFailure(undefined)
    try {
      const result = await postPanel<PanelHarnessUpdateResult>(
        `/panel/api/v1/harnesses/${connection.id}/update`,
        {}
      )
      setUpdate({
        id: connection.id,
        kind: connection.kind,
        from: result.from,
        to: result.to,
        startedAt: Date.now(),
      })
      setUpdateTarget(null)
      onChanged()
      void loadInstallInfo()
    } catch (cause) {
      setUpdateFailure({
        message: cause instanceof Error ? cause.message : String(cause),
        kind: connection.kind,
      })
      setUpdateTarget(null)
    } finally {
      setPending(undefined)
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

  const forget = async (connection: PanelHarness) => {
    setPending(`forget:${connection.id}`)
    setError(undefined)
    try {
      await postPanel(`/panel/api/v1/harnesses/${connection.id}/forget`, {})
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
      setForgetTarget(null)
    }
  }

  const purge = async (connection: PanelHarness) => {
    setPending(`delete:${connection.id}`)
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/harnesses/${connection.id}`)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const repair = updateFailure ? adapterRepairCommand(installInfo, updateFailure.kind) : undefined
  const active = harnesses.filter((connection) => !connection.forgottenAt)
  const forgotten = harnesses.filter((connection) => connection.forgottenAt)
  const ordered = [...active, ...forgotten]

  return (
    <CollapsibleCard
      title="Paired harnesses"
      description="Adapters enrolled with their own credential"
      icon={<Cable className="size-4" aria-hidden="true" />}
      action={
        <span className="inline-flex items-center gap-1">
          <Badge tone={active.length > 0 ? 'info' : 'neutral'}>{active.length} paired</Badge>
          {forgotten.length > 0 ? <Badge tone="neutral">{forgotten.length} forgotten</Badge> : null}
        </span>
      }
      defaultExpanded
    >
      <CardBody>
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
        {update ? (
          <Notice tone="warning">
            {redact(
              `Updating ${update.kind} from v${update.from} to v${update.to}. The adapter will restart and reconnect.`
            )}
          </Notice>
        ) : null}
        {updateFailure ? (
          <Notice tone="danger">
            {redact(updateFailure.message)}
            {repair ? (
              <div className="mt-1 break-all font-mono text-[10px] text-foreground">{repair}</div>
            ) : null}
          </Notice>
        ) : null}
        {test ? (
          <Notice tone={test.ok ? 'warning' : 'danger'}>
            {test.ok
              ? `Connection ok${test.version ? ` · ${test.version}` : ''} · ${test.latencyMs} ms`
              : redact(`${test.message ?? test.code}${test.status ? ` (${test.status})` : ''}`)}
          </Notice>
        ) : null}

        {harnesses.length === 0 ? (
          <EmptyState>
            No harness is paired yet. Use Pair Harness, then install the adapter on the machine that
            runs it.
          </EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Harness
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Host
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Fingerprint
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Added
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Last seen
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((connection) => {
                  const status = harnessState(connection, enabled)
                  const published = adapterUpdate(installInfo, connection)
                  const latest = published.latest
                  const updating = update?.id === connection.id
                  const updateAvailable =
                    enabled &&
                    installInfo?.available === true &&
                    connection.online &&
                    !connection.forgottenAt &&
                    published.available
                  return (
                    <tr
                      key={connection.id}
                      className={`border-t border-border ${
                        connection.forgottenAt ? 'text-muted-foreground' : ''
                      }`}
                    >
                      <td className="px-1 py-2">
                        <div className="font-medium">
                          {connection.label?.trim() || connection.kind}
                          {connection.harnessVersion ? ` · ${connection.harnessVersion}` : ''}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {masked ? PEEK_MASK : shortId(connection.harnessId)}
                          {connection.adapterVersion
                            ? ` · adapter v${connection.adapterVersion}`
                            : ''}
                          {updateAvailable && latest ? ` · update v${latest}` : ''}
                        </div>
                      </td>
                      <td className="px-1 py-2">
                        <div>{harnessHostSummary(connection.host) ?? '—'}</div>
                        <div className="mt-1">
                          <Badge tone={connection.transport === 'local' ? 'info' : 'neutral'}>
                            {connection.transport}
                          </Badge>
                        </div>
                      </td>
                      <td
                        className="px-1 py-2 font-mono"
                        title={masked ? undefined : connection.fingerprint}
                      >
                        {connection.fingerprint
                          ? masked
                            ? PEEK_MASK
                            : connection.fingerprint
                          : '—'}
                      </td>
                      <td className="px-1 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td
                        className="px-1 py-2 text-foreground"
                        title={formatTimestamp(connection.createdAt)}
                      >
                        {formatRelative(connection.createdAt, now)}
                      </td>
                      <td
                        className="px-1 py-2 text-foreground"
                        title={
                          connection.lastSeenAt ? formatTimestamp(connection.lastSeenAt) : undefined
                        }
                      >
                        {connection.lastSeenAt
                          ? formatRelative(connection.lastSeenAt, now)
                          : 'Never'}
                      </td>
                      <td className="px-1 py-2 text-right">
                        {connection.forgottenAt ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="xs"
                            onClick={() => void purge(connection)}
                            disabled={pending !== undefined}
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            {pending === `delete:${connection.id}` ? 'Deleting…' : 'Delete'}
                          </Button>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            {updateAvailable || updating ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() =>
                                  latest ? setUpdateTarget({ connection, to: latest }) : undefined
                                }
                                disabled={pending !== undefined || updating || !latest}
                              >
                                <RefreshCw
                                  className={`size-3 ${updating ? 'animate-spin' : ''}`}
                                  aria-hidden="true"
                                />
                                {updating ? 'Updating…' : 'Update'}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => void runTest(connection)}
                              disabled={pending !== undefined || updating}
                            >
                              <FlaskConical className="size-3" aria-hidden="true" />
                              {pending === `test:${connection.id}` ? 'Testing…' : 'Test'}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="xs"
                              onClick={() => setForgetTarget(connection)}
                              disabled={pending !== undefined || updating}
                            >
                              {pending === `forget:${connection.id}` ? 'Forgetting…' : 'Forget'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Every paired harness is independent; a workspace chooses the one it belongs to. Forget
          revokes the adapter credential and disconnects it but keeps its identity and Clara
          metadata; Delete a forgotten harness to remove it permanently. Test probes that adapter's
          harness endpoint. Update asks the connected adapter to pull the published release and
          restart; it must be online. Fingerprints identify the credential without revealing it.
        </p>
        <ConfirmDialog
          open={forgetTarget != null}
          title={forgetTarget ? `Forget "${forgetTarget.label}"?` : ''}
          description="This revokes the adapter credential and disconnects it. Its identity and Clara metadata stay, so you can pair it again or delete it permanently."
          confirmLabel="Forget"
          pendingLabel="Forgetting…"
          pending={forgetTarget != null && pending === `forget:${forgetTarget.id}`}
          danger
          onOpenChange={(open) => {
            if (!open) setForgetTarget(null)
          }}
          onConfirm={() => {
            if (forgetTarget) void forget(forgetTarget)
          }}
        />
        <ConfirmDialog
          open={updateTarget != null}
          title={
            updateTarget ? `Update "${updateTarget.connection.label}" to v${updateTarget.to}?` : ''
          }
          description={
            updateTarget
              ? `The adapter restarts from v${updateTarget.connection.adapterVersion ?? 'unknown'} to v${updateTarget.to}. Active runs on Claude Code or Pi may be interrupted; OpenCode sessions stay in the harness. The adapter must reconnect to the hub when it is done.`
              : ''
          }
          confirmLabel="Update"
          pendingLabel="Updating…"
          pending={updateTarget != null && pending === `update:${updateTarget.connection.id}`}
          onOpenChange={(open) => {
            if (!open) setUpdateTarget(null)
          }}
          onConfirm={() => {
            if (updateTarget) void runUpdate(updateTarget.connection)
          }}
        />
      </CardBody>
    </CollapsibleCard>
  )
}
