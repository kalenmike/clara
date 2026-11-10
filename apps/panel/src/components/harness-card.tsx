import { useState } from 'react'
import { Cable, Check, CircleAlert, FlaskConical, Plus, Trash2 } from 'lucide-react'
import type {
  PanelHarness,
  PanelHarnessMutationResponse,
  PanelHarnessState,
  PanelHarnessTestResult,
} from '@clara/shared-types'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { formatRelative, formatTimestamp } from '../lib/format.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, Notice } from './primitives.tsx'

type FormState = {
  label: string
  baseUrl: string
  authType: 'none' | 'basic'
  username: string
  password: string
}

const NEW_FORM: FormState = {
  label: 'OpenCode',
  baseUrl: 'http://opencode:4096',
  authType: 'basic',
  username: 'opencode',
  password: '',
}

export function HarnessCard({
  harness,
  harnesses,
  onChanged,
  now,
}: {
  harness: PanelHarnessState
  harnesses: PanelHarness[]
  onChanged: () => void
  now: number
}) {
  const { redact } = usePeek()
  const [editing, setEditing] = useState<string | 'new' | undefined>(
    harnesses.length === 0 ? 'new' : undefined
  )
  const [form, setForm] = useState<FormState>(NEW_FORM)
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const [test, setTest] = useState<PanelHarnessTestResult>()

  const beginNew = () => {
    setForm(NEW_FORM)
    setEditing('new')
    setError(undefined)
    setTest(undefined)
  }

  const beginEdit = (connection: PanelHarness) => {
    setForm({
      label: connection.label,
      baseUrl: connection.baseUrl,
      authType: connection.authType,
      username: connection.username ?? 'opencode',
      password: '',
    })
    setEditing(connection.id)
    setError(undefined)
    setTest(undefined)
  }

  const save = async () => {
    setPending('save')
    setError(undefined)
    try {
      const body = {
        kind: 'opencode' as const,
        label: form.label,
        baseUrl: form.baseUrl,
        authType: form.authType,
        ...(form.authType === 'basic' ? { username: form.username } : {}),
        ...(form.password ? { password: form.password } : {}),
      }
      if (editing === 'new') {
        await postPanel<PanelHarnessMutationResponse>('/panel/api/v1/harnesses', body)
      } else if (editing) {
        await postPanel<PanelHarnessMutationResponse>(`/panel/api/v1/harnesses/${editing}`, body)
      }
      setEditing(undefined)
      setForm(NEW_FORM)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
        {
          kind: connection.kind,
          label: connection.label,
          baseUrl: connection.baseUrl,
          authType: connection.authType,
          ...(connection.username ? { username: connection.username } : {}),
        }
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

  const remove = async (connection: PanelHarness) => {
    if (!window.confirm(`Delete the harness connection "${connection.label}"?`)) return
    setPending(`delete:${connection.id}`)
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/harnesses/${connection.id}`)
      if (editing === connection.id) setEditing(undefined)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const disabled = pending !== undefined

  return (
    <CollapsibleCard
      title="Harness connections"
      description="The coding-agent API this agent proxies to paired clients"
      icon={<Cable className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={harness.configured ? 'success' : 'warning'}>
          {harness.configured ? 'Configured' : 'Not configured'}
        </Badge>
      }
      defaultExpanded={!harness.configured}
    >
      <CardBody>
        {harness.error ? <Notice tone="danger">{redact(harness.error)}</Notice> : null}
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
        {test ? (
          <Notice tone={test.ok ? 'warning' : 'danger'}>
            {test.ok
              ? `Connection ok${test.version ? ` · ${test.version}` : ''} · ${test.latencyMs} ms`
              : `${test.message ?? test.code}${test.status ? ` (${test.status})` : ''}`}
          </Notice>
        ) : null}

        {harnesses.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No harness is configured yet. Add the OpenCode URL and password to start proxying.
          </p>
        ) : (
          <div className="space-y-2">
            {harnesses.map((connection) => (
              <div
                key={connection.id}
                className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {connection.label}
                      {connection.isActive ? <Badge tone="success">Active</Badge> : null}
                      {connection.secretConfigured ? (
                        <Badge tone="neutral">Secret set</Badge>
                      ) : null}
                    </div>
                    <p className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      {connection.baseUrl} · {connection.authType}
                      {connection.username ? ` · ${connection.username}` : ''}
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
                      onClick={() => beginEdit(connection)}
                      disabled={disabled}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      Edit
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
                  </div>
                </div>
                {connection.lastTestAt ? (
                  <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    Last test {formatRelative(connection.lastTestAt, now)} ·{' '}
                    <span title={formatTimestamp(connection.lastTestAt)}>
                      {connection.lastTestOk ? 'ok' : (connection.lastTestError ?? 'failed')}
                    </span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {editing === undefined ? (
          <button
            type="button"
            onClick={beginNew}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add connection
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">
                {editing === 'new' ? 'New OpenCode connection' : 'Edit connection'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(undefined)}
                className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Cancel
              </button>
            </div>
            <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Label
              <input
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
            <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              Base URL
              <input
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="http://opencode:4096"
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
                Inside the server container, 127.0.0.1 is the Clara server. Use the OpenCode
                container service name (for example http://opencode:4096) or host.docker.internal.
              </span>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                Authentication
                <select
                  value={form.authType}
                  onChange={(event) =>
                    setForm({ ...form, authType: event.target.value as 'none' | 'basic' })
                  }
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="basic">Basic auth</option>
                  <option value="none">No authentication</option>
                </select>
              </label>
              {form.authType === 'basic' ? (
                <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                  Username
                  <input
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
              ) : null}
            </div>
            {form.authType === 'basic' ? (
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                Password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder={editing === 'new' ? 'Required' : 'Leave blank to keep the saved one'}
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                {pending === 'save' ? 'Saving…' : 'Save connection'}
              </button>
            </div>
          </div>
        )}

        {!harness.configured && harnesses.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            Activate one connection before pairing a client.
          </p>
        ) : null}
      </CardBody>
    </CollapsibleCard>
  )
}
