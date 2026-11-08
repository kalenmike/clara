import { useCallback, useEffect, useState } from 'react'
import { callTool, getRun, getRuns, getStep, registerAdapter, setHeartbeat } from '../api'
import type { LabStream } from '../useLab'
import type { PreflightResult, RunRow, StatusResult, StepRow, StepSummary } from '../types'
import { dateTime, short, statusTone } from '../lib/format'
import { friendlyError } from '../lib/errors'
import { Badge, Field } from './Badge'
import { RunEvents, RunStepDetail } from './RunDetail'
import { RunTree } from './StepTree'
import { WorkOrderCard } from './WorkOrderCard'

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function needsAdapter(value: unknown): boolean {
  const text = valueText(value).toLowerCase()
  return text.includes('enforcement_unavailable') || text.includes('strict enforcement')
}

export function Runs({
  stream,
  hostWorkspace,
  runtimeWorkspace,
  target,
  pauseAfterStep,
  onPauseAfterStepChange,
  active,
  preflight,
  onPreflight,
  onGoToPipeline,
  onGoToSetup,
  onNotice,
}: {
  stream: LabStream
  hostWorkspace: string
  runtimeWorkspace: string
  target: string
  pauseAfterStep: boolean
  onPauseAfterStepChange: (value: boolean) => void
  active: boolean
  preflight: PreflightResult | null
  onPreflight: () => void
  onGoToPipeline: () => void
  onGoToSetup: () => void
  onNotice: (message: string) => void
}) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedID, setSelectedID] = useState<number | undefined>()
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [selectedStep, setSelectedStep] = useState<string | undefined>()
  const [stepDetail, setStepDetail] = useState<StepRow | null>(null)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
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
          : (value.steps.find(
              (step) =>
                step.status === 'running' && (step.type === 'task' || step.type === 'router')
            )?.path ??
            value.steps.find((step) => step.type === 'task' || step.type === 'router')?.path ??
            value.steps.find((step) => step.status === 'running')?.path ??
            value.steps[0]?.path)
      )
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refreshRuns()
  }, [active, refreshRuns])

  useEffect(() => {
    if (!active) return
    if (!selectedID) {
      setStatus(null)
      return
    }
    void refreshStatus(selectedID)
  }, [active, selectedID, refreshStatus])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      void refreshRuns()
      if (selectedID) void refreshStatus(selectedID)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [active, stream.eventRevision, selectedID, refreshRuns, refreshStatus])

  useEffect(() => {
    if (!active || !selectedID || !selectedStep) {
      setStepDetail(null)
      return
    }
    let cancelled = false
    getStep(selectedID, selectedStep)
      .then((value) => {
        if (!cancelled) setStepDetail(value)
      })
      .catch((cause) => {
        if (!cancelled) {
          setStepDetail(null)
          setError(message(cause))
        }
      })
    return () => {
      cancelled = true
    }
  }, [active, selectedID, selectedStep, status])

  const start = async (): Promise<void> => {
    if (!prompt.trim()) {
      setError('Enter a prompt before starting a run.')
      return
    }
    if (!runtimeWorkspace.trim()) {
      setError('The orchestrator has not reported its workspace yet. Reconnect in Setup.')
      return
    }
    setBusy(true)
    setError(null)
    const args = {
      prompt,
      workspace: runtimeWorkspace,
      ...(target ? { target } : {}),
      origin: { harness: 'clara-lab', agent: 'lab', kind: 'agent' },
    }
    try {
      let response = await callTool<{ run?: RunRow }>('clara_start', args)
      if (response.isError && needsAdapter(response.value)) {
        await registerAdapter(runtimeWorkspace)
        onNotice('Registered the clara-lab adapter automatically.')
        onPreflight()
        response = await callTool<{ run?: RunRow }>('clara_start', args)
      }
      if (response.isError) throw new Error(valueText(response.value))
      const run = response.value?.run
      if (run) {
        setSelectedID(run.id)
        await refreshStatus(run.id)
        onNotice(`Started run #${run.id}.`)
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
      onNotice('Watchdog tick complete.')
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
      await callTool('clara_cancel', {
        run_id: selectedID,
        reason: 'cancelled from Clara Lab',
      })
      await refreshStatus(selectedID)
      await refreshRuns()
      onNotice(`Run #${selectedID} cancelled.`)
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
    if (!runtimeWorkspace.trim()) {
      setError('The orchestrator has not reported its workspace yet. Reconnect in Setup.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await registerAdapter(runtimeWorkspace)
      onPreflight()
      onNotice('Registered the clara-lab adapter.')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const work = (stream.snapshot?.work ?? []).filter(
    (record) => !selectedID || record.order.run_id === selectedID
  )
  const current = work[0]
  const events = selectedID
    ? stream.events.filter((event) => event.run_id === selectedID)
    : stream.events
  const heartbeat = stream.snapshot?.heartbeat ?? true
  const adapters = stream.snapshot?.adapters ?? []
  const taskSteps =
    status?.steps.filter((entry) => entry.type === 'task' || entry.type === 'router') ?? []
  const doneSteps = taskSteps.filter(
    (entry) => entry.status === 'done' || entry.status === 'skipped'
  ).length
  const totalSteps = status?.taskCount
  const friendly = error ? friendlyError(error, 'start') : null
  const isActiveRun =
    status?.run.state === 'running' ||
    status?.run.state === 'waiting' ||
    status?.run.state === 'queued'

  return (
    <div className="runs">
      <div className="toolbar">
        <label className="check">
          <input
            type="checkbox"
            checked={pauseAfterStep}
            onChange={(event) => onPauseAfterStepChange(event.target.checked)}
          />
          Pause after each step
        </label>
        <button type="button" className="button" onClick={() => void refreshRuns()} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="button ghost" onClick={onGoToPipeline}>
          Change pipeline
        </button>
        <button type="button" className="button ghost" onClick={onGoToSetup}>
          Setup
        </button>
        {heartbeat ? null : <Badge tone="warn">heartbeats paused</Badge>}
      </div>

      {friendly ? (
        <div className="banner bad">
          <strong>{friendly.title}.</strong> {friendly.detail}
          {friendly.hint ? <div className="muted">{friendly.hint}</div> : null}
        </div>
      ) : null}

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
            <h3>Adapter</h3>
          </div>
          <div className="adapter">
            <div className="row-between">
              <span>{adapters.length ? `live (${adapters.length})` : 'not registered'}</span>
              <button
                type="button"
                className="link"
                onClick={() => void register()}
                disabled={busy}
              >
                register
              </button>
            </div>
            <div className="muted">
              Strict pipelines need the clara-lab adapter. It is for orchestration testing, not real
              enforcement.
            </div>
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
              <span className="muted"> you are the AI: read the task, send the result</span>
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
              <div className="start-context">
                <span>
                  Pipeline <strong>{target || 'Entry router'}</strong>{' '}
                  <button type="button" className="link" onClick={onGoToPipeline}>
                    change
                  </button>
                </span>
                <span>
                  Orchestrator sees{' '}
                  <code>{runtimeWorkspace || 'waiting for the orchestrator'}</code>{' '}
                  <button type="button" className="link" onClick={onGoToSetup}>
                    setup
                  </button>
                </span>
              </div>
              {preflight?.host.strict && !preflight.adapter.ok ? (
                <div className="banner warn">
                  This pipeline is strict. Clara Lab will register its own adapter when you start.
                </div>
              ) : null}
              <div className="row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void start()}
                  disabled={busy || !prompt.trim()}
                >
                  Start run
                </button>
                <span className="muted">
                  Origin is recorded as <code>clara-lab / lab / agent</code>.
                </span>
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
                  <span className="chip">
                    {totalSteps ? `${doneSteps}/${totalSteps} steps` : `${doneSteps} steps done`}
                  </span>
                  {current ? <span className="chip">now: {current.order.name}</span> : null}
                  <span className="chip">{status.run.pipeline_ref}</span>
                  {status.run.enforcement === 'strict' ? (
                    <span className="chip chip-warn">strict</span>
                  ) : null}
                </div>
              </div>

              <div className="grid three">
                <Field label="Host files" value={hostWorkspace || '—'} />
                <Field label="Orchestrator workspace" value={status.run.workspace} />
                <Field
                  label="Origin"
                  value={`${status.run.origin_harness ?? '—'} / ${status.run.origin_agent ?? '—'} / ${status.run.origin_kind}`}
                />
                <Field label="Created" value={dateTime(status.run.created_at)} />
                <Field
                  label="Finished"
                  value={status.run.finished_at ? dateTime(status.run.finished_at) : '—'}
                />
                <Field label="Hash" value={status.run.hash.slice(0, 20)} />
              </div>
              {status.run.error ? <div className="banner bad">{status.run.error}</div> : null}

              <div className="panel-head">
                <h3>
                  {current
                    ? 'Current step'
                    : status.run.state === 'completed'
                      ? 'Run complete'
                      : 'Next step'}
                </h3>
                <div className="row">
                  <span className="muted">
                    {work.length ? `${work.length} claimed` : 'nothing claimed'}
                  </span>
                  {isActiveRun ? (
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void pullNext(status.run.id)}
                      disabled={busy}
                    >
                      Pull next
                    </button>
                  ) : null}
                </div>
              </div>
              {work.length ? (
                work.map((record, index) => (
                  <WorkOrderCard
                    key={record.key}
                    record={record}
                    autoRun={!pauseAfterStep}
                    primary={index === 0}
                    onChanged={changed}
                    onNotice={onNotice}
                  />
                ))
              ) : (
                <div className="empty">
                  {isActiveRun
                    ? 'No step is claimed. Use Pull next to claim ready work.'
                    : status.run.state === 'completed'
                      ? 'Run complete. Choose a pipeline or change the prompt to start another.'
                      : `Run ${status.run.state}.`}
                </div>
              )}

              <div className="panel-head">
                <h3>Steps</h3>
                <span className="muted">click a step for its result, lease, and usage</span>
              </div>
              <RunTree
                steps={status.steps}
                selected={selectedStep}
                onSelect={(entry: StepSummary) => setSelectedStep(entry.path)}
              />
              <RunStepDetail step={stepDetail ?? undefined} />

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

              <details className="panel events-panel">
                <summary>
                  Events <span className="muted">({events.length})</span>
                </summary>
                <RunEvents events={events} />
              </details>

              <details className="panel advanced-panel">
                <summary>Run controls</summary>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void tick()}
                    disabled={busy}
                  >
                    Watchdog tick
                  </button>
                  <button type="button" className="button" onClick={() => void toggleHeartbeat()}>
                    {heartbeat ? 'Pause heartbeats' : 'Resume heartbeats'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void register()}
                    disabled={busy}
                  >
                    Re-register adapter
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => void cancel()}
                    disabled={busy}
                  >
                    Cancel run
                  </button>
                </div>
                <div className="muted">
                  Heartbeat holds the lease while you type. Pausing it lets the watchdog retry the
                  step after the stall threshold.
                </div>
              </details>
            </>
          ) : runs.length ? (
            <div className="empty">Select a run from the list.</div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
