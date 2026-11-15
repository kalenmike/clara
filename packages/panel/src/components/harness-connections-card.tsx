import { useState } from 'react'
import { Cable, FlaskConical, Trash2 } from 'lucide-react'
import type { PanelHarness, PanelHarnessTestResult } from '@clara/shared-types'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { harnessState } from '../lib/harness-state.ts'
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
  const [removeTarget, setRemoveTarget] = useState<{
    connection: PanelHarness
    forget: boolean
  } | null>(null)
  const [error, setError] = useState<string>()
  const [test, setTest] = useState<PanelHarnessTestResult>()

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

  const remove = async (connection: PanelHarness, forget: boolean) => {
    const action = forget ? 'forget' : 'delete'
    setPending(`${action}:${connection.id}`)
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
      setRemoveTarget(null)
    }
  }

  return (
    <CollapsibleCard
      title="Paired harnesses"
      description="Adapters enrolled with their own credential"
      icon={<Cable className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={harnesses.length > 0 ? 'info' : 'neutral'}>{harnesses.length} paired</Badge>
      }
      defaultExpanded
    >
      <CardBody>
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
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
            <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Harness
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Fingerprint
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Transport
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
                  <th scope="col" className="px-1 py-2 font-medium">
                    Last test
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {harnesses.map((connection) => {
                  const status = harnessState(connection, enabled)
                  return (
                    <tr key={connection.id} className="border-t border-border">
                      <td className="px-1 py-2">
                        <div className="font-medium">{connection.label}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {connection.kind} · {masked ? PEEK_MASK : shortId(connection.harnessId)}
                          {connection.harnessVersion ? ` · ${connection.harnessVersion}` : ''}
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
                        <Badge tone={connection.transport === 'local' ? 'info' : 'neutral'}>
                          {connection.transport}
                        </Badge>
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
                      <td
                        className="px-1 py-2 text-foreground"
                        title={
                          connection.lastTestAt ? formatTimestamp(connection.lastTestAt) : undefined
                        }
                      >
                        {connection.lastTestAt ? (
                          <>
                            {formatRelative(connection.lastTestAt, now)} ·{' '}
                            <span
                              className={
                                connection.lastTestOk ? '' : 'text-red-600 dark:text-red-400'
                              }
                            >
                              {connection.lastTestOk
                                ? 'ok'
                                : redact(connection.lastTestError ?? 'failed')}
                            </span>
                          </>
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="px-1 py-2 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void runTest(connection)}
                            disabled={pending !== undefined}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium transition hover:bg-accent disabled:opacity-50"
                          >
                            <FlaskConical className="size-3" aria-hidden="true" />
                            {pending === `test:${connection.id}` ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveTarget({ connection, forget: false })}
                            disabled={pending !== undefined}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            {pending === `delete:${connection.id}` ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveTarget({ connection, forget: true })}
                            disabled={pending !== undefined}
                            className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                          >
                            {pending === `forget:${connection.id}` ? 'Forgetting…' : 'Forget'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Every paired harness is independent; a workspace chooses the one it belongs to. Delete
          removes the connection but keeps the adapter identity and Clara metadata; Forget purges
          both. Test probes that adapter's harness endpoint. Fingerprints identify the credential
          without revealing it.
        </p>
        <ConfirmDialog
          open={removeTarget != null}
          title={
            removeTarget
              ? removeTarget.forget
                ? `Forget "${removeTarget.connection.label}"?`
                : `Delete the "${removeTarget.connection.label}" connection?`
              : ''
          }
          description={
            removeTarget?.forget
              ? 'This purges the connection and its Clara session metadata.'
              : 'This removes the connection but keeps its identity and metadata.'
          }
          confirmLabel={removeTarget?.forget ? 'Forget' : 'Delete'}
          pendingLabel={removeTarget?.forget ? 'Forgetting…' : 'Deleting…'}
          pending={
            removeTarget != null &&
            pending === `${removeTarget.forget ? 'forget' : 'delete'}:${removeTarget.connection.id}`
          }
          danger
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
          onConfirm={() => {
            if (removeTarget) void remove(removeTarget.connection, removeTarget.forget)
          }}
        />
      </CardBody>
    </CollapsibleCard>
  )
}
