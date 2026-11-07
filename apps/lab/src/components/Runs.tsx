import { useCallback, useEffect, useState } from 'react'
import {
  callTool,
  getRun,
  getRuns,
  reconnect,
  registerAdapter,
  removeAdapter,
  setHeartbeat,
} from '../api'
import type { LabStream } from '../useLab'
import type { RunRow, StatusResult, StepRow } from '../types'
import { dateTime, short, statusTone } from '../lib/format'
import { Badge, Field } from './Badge'
import { RunStepDetail, RunEvents } from './RunDetail'
import { RunTree } from './StepTree'
import { WorkOrderCard } from './WorkOrderCard'

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function Runs({
  stream,
  initialTarget,
  onInitialTargetConsumed,
}: {
  stream: LabStream
  initialTarget?: string
  onInitialTargetConsumed: () => void
}) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedID, setSelectedID] = useState<number | undefined>()
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [selectedStep, setSelectedStep] = useState<string | undefined>()
  const [prompt, setPrompt] = useState('')
  const [workspace, setWorkspace] = useState(stream.snapshot?.workspace ?? '')
  const [target, setTarget] = useState('')
  const [autoRun, setAutoRun] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshRuns = useCallback(async () => {
    try {
      const result = await getRuns()
      const list = Array.isArray(result.value) ? (result.value as RunRow[]) : []
      setRuns(list)
      setSelectedID((current) =>
        current && list.some((run) => run.id === current) ? current : list[0]?.id
      )
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  const refreshStatus = useCallback(async (id: number) => {
    try {
      const result = await getRun(id)
      if (!result.value || typeof result.value !== 'object') return
      const value = result.value as StatusResult
      setStatus(value)
      setSelectedStep((current) =>
        current && value.steps.some((step) => step.path === current)
          ? current
          : (value.steps.find((step) => step.status === 'running')?.path ??
            value.steps.find((step) => step.type === 'task' || step.type === 'router')?.path ??
            value.steps[0]?.path)
      )
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  useEffect(() => {
    if (workspace || !stream.snapshot?.workspace) return
    setWorkspace(stream.snapshot.workspace)
  }, [stream.snapshot?.workspace, workspace])

  useEffect(() => {
    if (initialTarget === undefined) return
    setTarget(initialTarget)
    onInitialTargetConsumed()
  }, [initialTarget, onInitialTargetConsumed])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    if (!selectedID) return
    void refreshStatus(selectedID)
  }, [selectedID, refreshStatus])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshRuns()
      if (selectedID) void refreshStatus(selectedID)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [stream.eventRevision, selectedID, refreshRuns, refreshStatus])

  const start = async (): Promise<void> => {
    if (!prompt.trim()) {
      setError('Enter a prompt before starting a run.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await callTool<{ run?: RunRow }>('clara_start', {
        prompt,
        workspace: workspace || stream.snapshot?.workspace || '',
        ...(target.trim() ? { target: target.trim() } : {}),
        origin: { harness: 'clara-lab', agent: 'lab', kind: 'agent' },
      })
      if (response.isError) {
        throw new Error(typeof response.value === 'string' ? response.value : short(response.value))
      }
      const run = response.value?.run
      if (run) {
        setSelectedID(run.id)
        setNotice(`Started run #${run.id}`)
        await refreshStatus(run.id)
      }
      setPrompt('')
      await refreshRuns()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const pullNext = async (runID: number): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await callTool('clara_next', { run_id: runID, limit: 8 })
      await refreshStatus(runID)
      await refreshRuns()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const changed = (runID: number): void => {
    setSelectedID(runID)
    void refreshStatus(runID)
    void refreshRuns()
  }

  const tick = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await callTool('clara_tick', {})
      if (selectedID) await refreshStatus(selectedID)
      await refreshRuns()
      setNotice('Watchdog tick complete.')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!selectedID) return
    if (!window.confirm(`Cancel run #${selectedID} and all of its children?`)) return
    setBusy(true)
    setError(null)
    try {
      await callTool('clara_cancel', { run_id: selectedID, reason: 'cancelled from Clara Lab' })
      await refreshStatus(selectedID)
      await refreshRuns()
      setNotice(`Run #${selectedID} cancelled.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const ack = async (alertID: number): Promise<void> => {
    try {
      await callTool('clara_ack', { alert_id: alertID })
      if (selectedID) await refreshStatus(selectedID)
    } catch (cause) {
      setError(message(cause))
    }
  }

  const toggleHeartbeat = async (): Promise<void> => {
    try {
      await setHeartbeat(!(stream.snapshot?.heartbeat ?? true))
    } catch (cause) {
      setError(message(cause))
    }
  }

  const register = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const value = workspace || stream.snapshot?.workspace || ''
      await registerAdapter(value)
      setNotice('Registered the clara-lab adapter.')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const unregister = async (id: string): Promise<void> => {
    try {
      await removeAdapter(id)
      setNotice('Removed the adapter.')
    } catch (cause) {
      setError(message(cause))
    }
  }

  const reconnectNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await reconnect()
      setNotice('Reconnected to the orchestrator.')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const work = (stream.snapshot?.work ?? []).filter(
    (record) => !selectedID || record.order.run_id === selectedID
  )
  const events = selectedID
    ? stream.events.filter((event) => event.run_id === selectedID)
    : stream.events
  const step = status?.steps.find((entry) => entry.path === selectedStep)
  const heartbeat = stream.snapshot?.heartbeat ?? true
  const adapters = stream.snapshot?.adapters ?? []

  return (
    <div className="runs">
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={heartbeat} onChange={() => void toggleHeartbeat()} />
          Auto-heartbeat
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={(event) => setAutoRun(event.target.checked)}
          />
          Auto-pull next
        </label>
        <button type="button" className="button" onClick={() => void tick()} disabled={busy}>
          Watchdog tick
        </button>
        <button type="button" className="button" onClick={() => void refreshRuns()} disabled={busy}>
          Refresh
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void reconnectNow()}
          disabled={busy}
        >
          Reconnect
        </button>
        {selectedID ? (
          <button
            type="button"
            className="button danger"
            onClick={() => void cancel()}
            disabled={busy}
          >
            Cancel run
          </button>
        ) : null}
        {heartbeat ? null : (
          <Badge tone="warn">heartbeats paused — the watchdog will retry this work</Badge>
        )}
      </div>

      {error ? <div className="banner bad">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="runs-grid">
        <aside className="panel run-list">
          <div className="panel-head">
            <h3>Runs</h3>
            <span className="muted">{runs.length}</span>
          </div>
          <div className="run-list-items">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className={`run-item ${selectedID === run.id ? 'selected' : ''}`}
                onClick={() => setSelectedID(run.id)}
              >
                <div className="row-between">
                  <span>
                    <strong>#{run.id}</strong> {run.target}
                  </span>
                  <Badge tone={statusTone(run.state)}>{run.state}</Badge>
                </div>
                <div className="muted">{short(run.prompt, 90)}</div>
              </button>
            ))}
            {!runs.length ? <div className="empty">No runs yet.</div> : null}
          </div>

          <div className="panel-head">
            <h3>Lab adapters</h3>
            <button
              type="button"
              className="button ghost small"
              onClick={() => void register()}
              disabled={busy}
            >
              Register
            </button>
          </div>
          <div className="adapter-list">
            {adapters.map((adapter) => (
              <div key={adapter.id} className="adapter">
                <div className="row-between">
                  <strong>{adapter.harness}</strong>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void unregister(adapter.id)}
                  >
                    remove
                  </button>
                </div>
                <div className="muted">{adapter.id.slice(0, 12)}…</div>
                <div className="muted">{adapter.capabilities}</div>
              </div>
            ))}
            {!adapters.length ? (
              <div className="empty">
                No live adapter. Strict targets fail closed until you register one.
              </div>
            ) : null}
          </div>

          {status?.alerts.length ? (
            <>
              <div className="panel-head">
                <h3>Alerts</h3>
              </div>
              <div className="alert-list">
                {status.alerts.map((alert) => (
                  <div key={alert.id} className="alert">
                    <div className="row-between">
                      <Badge tone="warn">{alert.kind}</Badge>
                      <code>#{alert.id}</code>
                    </div>
                    <div>{alert.title}</div>
                    <div className="muted">{alert.body}</div>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void ack(alert.id)}
                    >
                      Acknowledge
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </aside>

        <section className="panel run-main">
          <details className="start-panel" open={!runs.length}>
            <summary>
              <strong>Start a run</strong>
              <span className="muted"> act as the agent at the MCP boundary</span>
            </summary>
            <div className="start-form">
              <label className="full">
                Prompt
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What should the pipeline work on?"
                />
              </label>
              <div className="row">
                <label className="grow">
                  Workspace
                  <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
                </label>
                <label className="grow">
                  Target (blank = entry)
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="std:software/feature"
                  />
                </label>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void start()}
                  disabled={busy}
                >
                  Start
                </button>
              </div>
              <div className="muted">
                Origin is recorded as <code>harness: clara-lab</code>, <code>agent: lab</code>,{' '}
                <code>kind: agent</code>.
              </div>
            </div>
          </details>

          {status ? (
            <>
              <div className="run-head">
                <div>
                  <div className="work-title">
                    <Badge tone={statusTone(status.run.state)}>{status.run.state}</Badge>
                    <h3>Run #{status.run.id}</h3>
                    <span className="muted">{status.run.target}</span>
                  </div>
                  <div className="muted">{short(status.run.prompt, 180)}</div>
                </div>
                <div className="chips">
                  <span className="chip">{status.run.pipeline_ref}</span>
                  <span className="chip">{status.run.enforcement}</span>
                  <span className="chip">{status.run.hash.slice(0, 18)}…</span>
                </div>
              </div>

              <div className="grid three">
                <Field
                  label="Origin"
                  value={`${status.run.origin_harness ?? '—'} / ${status.run.origin_agent ?? '—'} / ${status.run.origin_kind}`}
                />
                <Field label="Created" value={dateTime(status.run.created_at)} />
                <Field
                  label="Finished"
                  value={status.run.finished_at ? dateTime(status.run.finished_at) : '—'}
                />
              </div>
              {status.run.error ? <div className="banner bad">{status.run.error}</div> : null}

              <div className="panel-head">
                <h3>Work queue</h3>
                <div className="row">
                  <span className="muted">{work.length} claimed</span>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => void pullNext(status.run.id)}
                    disabled={busy}
                  >
                    Pull next
                  </button>
                </div>
              </div>
              {work.length ? (
                work.map((record) => (
                  <WorkOrderCard
                    key={record.key}
                    record={record}
                    autoRun={autoRun}
                    onChanged={changed}
                  />
                ))
              ) : (
                <div className="empty">
                  No claimed work order. Use <strong>Pull next</strong> to claim ready work.
                </div>
              )}

              <div className="panel-head">
                <h3>Steps</h3>
                <span className="muted">click a step for its result, lease, and usage</span>
              </div>
              <RunTree
                steps={status.steps}
                selected={selectedStep}
                onSelect={(entry: StepRow) => setSelectedStep(entry.path)}
              />
              <RunStepDetail step={step} />

              {status.children.length ? (
                <>
                  <div className="panel-head">
                    <h3>Child runs</h3>
                  </div>
                  <div className="children">
                    {status.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className="button ghost small"
                        onClick={() => setSelectedID(child.id)}
                      >
                        #{child.id} {child.target} · {child.state}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="panel-head">
                <h3>Events</h3>
                <span className="muted">{events.length}</span>
              </div>
              <RunEvents events={events} />
            </>
          ) : (
            <div className="empty">Start a run or select one from the list.</div>
          )}
        </section>
      </div>
    </div>
  )
}
