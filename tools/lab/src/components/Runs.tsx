import { useCallback, useEffect, useState } from 'react'
import { callTool, cancelAllRuns, getRun, getRuns, getStep } from '../api'
import type { LabStream } from '../useLab'
import type { RunRow, StatusResult, StepDetail, StepSummary } from '../types'
import { dateTime, formatTokens, modelLabel, short, statusTone } from '../lib/format'
import { friendlyError } from '../lib/errors'
import {
  debugRuns as onlyDebugRuns,
  isActiveRun,
  isDebugRun,
  sortRuns,
  visibleRuns,
} from '../lib/runs'
import { Badge, Field } from './Badge'
import { Icon } from './Icon'
import { totalUsage } from '../lib/usage'
import { RunEvents, RunStepDetail } from './RunDetail'
import { RunTree } from './StepTree'

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function originText(run: RunRow): string {
  const harness = run.origin_harness ?? 'no harness'
  const agent = run.origin_agent ? ` / ${run.origin_agent}` : ''
  return `${harness}${agent} · ${run.origin_kind}`
}

function currentStep(steps: StepSummary[] | undefined): StepSummary | undefined {
  return (
    steps?.find((step) => step.status === 'running') ??
    steps?.find((step) => step.status === 'waiting') ??
    steps?.find((step) => step.type === 'agent' || step.type === 'router' || step.type === 'script')
  )
}

export function Runs({
  stream,
  hostWorkspace,
  active,
  showDebugRuns,
  onShowDebugRunsChange,
  focusRunID,
  onFocusHandled,
  onOpenReview,
  onNotice,
}: {
  stream: LabStream
  hostWorkspace: string
  active: boolean
  showDebugRuns: boolean
  onShowDebugRunsChange: (value: boolean) => void
  focusRunID?: number
  onFocusHandled: () => void
  onOpenReview: (runID: number) => void
  onNotice: (message: string) => void
}) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedID, setSelectedID] = useState<number | undefined>()
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [selectedStep, setSelectedStep] = useState<string | undefined>()
  const [stepDetail, setStepDetail] = useState<StepDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshRuns = useCallback(async () => {
    try {
      const result = await getRuns()
      const list = Array.isArray(result.value) ? (result.value as RunRow[]) : []
      setRuns(list)
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
                step.status === 'running' &&
                (step.type === 'agent' || step.type === 'router' || step.type === 'script')
            )?.path ??
            value.steps.find(
              (step) => step.type === 'agent' || step.type === 'router' || step.type === 'script'
            )?.path ??
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
    const visible = sortRuns(visibleRuns(runs, showDebugRuns))
    setSelectedID((current) =>
      current && visible.some((run) => run.id === current) ? current : visible[0]?.id
    )
  }, [runs, showDebugRuns])

  useEffect(() => {
    setError(null)
  }, [selectedID])

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
    if (
      !status ||
      status.run.id !== selectedID ||
      !status.steps.some((entry) => entry.path === selectedStep)
    ) {
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

  useEffect(() => {
    if (!focusRunID || !runs.length) return
    const run = runs.find((entry) => entry.id === focusRunID)
    if (!run) {
      onFocusHandled()
      return
    }
    if (isDebugRun(run) && !showDebugRuns) {
      onShowDebugRunsChange(true)
      return
    }
    setSelectedID(run.id)
    onFocusHandled()
  }, [focusRunID, runs, showDebugRuns, onFocusHandled, onShowDebugRunsChange])

  const debug = onlyDebugRuns(runs)
  const visible = sortRuns(visibleRuns(runs, showDebugRuns))
  const allActiveCount = runs.filter(isActiveRun).length
  const hiddenDebugActive = debug.filter(isActiveRun).length
  const selectedStatus = status && status.run.id === selectedID ? status : null
  const selectedRun = selectedStatus?.run ?? visible.find((run) => run.id === selectedID)
  const totals = totalUsage(selectedStatus?.steps ?? [])
  const currentWork = (stream.snapshot?.work ?? []).find(
    (record) => record.order.run_id === selectedID
  )
  const step =
    selectedRun && isActiveRun(selectedRun) ? currentStep(selectedStatus?.steps) : undefined
  const isDebug = selectedRun ? isDebugRun(selectedRun) : false
  const friendly = error ? friendlyError(error, 'runtime') : null

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
        reason: 'cancelled from Clara Lab runs',
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

  const killAll = async (): Promise<void> => {
    const hidden = showDebugRuns ? 0 : hiddenDebugActive
    const scope = hidden
      ? ` This includes ${hidden} hidden debug run${hidden === 1 ? '' : 's'}.`
      : ''
    if (
      !window.confirm(`Cancel every active run and its children?${scope} This cannot be undone.`)
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await cancelAllRuns()
      await refreshRuns()
      if (selectedID) await refreshStatus(selectedID)
      if (result.failed.length) {
        setError(
          `Cancelled ${result.cancelled} runs, but ${result.failed.length} failed: ${result.failed
            .map((entry) => `#${entry.id} ${entry.error}`)
            .join('; ')}`
        )
      } else {
        onNotice(
          result.cancelled
            ? `Cancelled ${result.cancelled} active run${result.cancelled === 1 ? '' : 's'}.`
            : 'No active runs to cancel.'
        )
      }
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view runs-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">Operations</div>
          <h1>Runs</h1>
          <p className="muted">
            Inspect runs and stop runaway work. Debug runs are hidden by default; start and step
            them from the Debug dock on Review.
          </p>
        </div>
        <div className="view-head-actions">
          {allActiveCount ? <Badge tone="live">{allActiveCount} active</Badge> : null}
          {!showDebugRuns && hiddenDebugActive ? (
            <Badge tone="warn">{hiddenDebugActive} debug hidden</Badge>
          ) : null}
          <label className="check runs-debug-toggle">
            <input
              type="checkbox"
              checked={showDebugRuns}
              onChange={(event) => onShowDebugRunsChange(event.target.checked)}
            />
            Show debug runs{debug.length ? ` (${debug.length})` : ''}
          </label>
          <button
            type="button"
            className="button"
            onClick={() => void refreshRuns()}
            disabled={busy}
          >
            Refresh
          </button>
          <button
            type="button"
            className="button danger"
            onClick={() => void killAll()}
            disabled={busy || !allActiveCount}
          >
            Kill all runs
          </button>
        </div>
      </header>

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
            <span className="muted">{visible.length}</span>
          </div>
          <div className="run-list-items">
            {visible.map((run) => (
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
                  <span className="row">
                    {isDebugRun(run) ? <Badge tone="warn">debug</Badge> : null}
                    <Badge tone={statusTone(run.state)}>{run.state}</Badge>
                  </span>
                </div>
                <div className="muted">{short(run.prompt, 90)}</div>
                <div className="run-origin muted">{originText(run)}</div>
              </button>
            ))}
            {!visible.length ? (
              <div className="empty">
                {debug.length && !showDebugRuns ? (
                  <>
                    No external runs.{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onShowDebugRunsChange(true)}
                    >
                      Show {debug.length} debug run{debug.length === 1 ? '' : 's'}
                    </button>
                  </>
                ) : (
                  'No runs yet.'
                )}
              </div>
            ) : null}
          </div>

          {selectedStatus?.alerts.length ? (
            <>
              <div className="panel-head">
                <h3>Alerts</h3>
              </div>
              <div className="alert-list">
                {selectedStatus.alerts.map((alert) => (
                  <div key={alert.id} className="alert">
                    <div className="row-between">
                      <Badge tone="warn">{alert.kind}</Badge>
                      <code>#{alert.id}</code>
                    </div>
                    <div>{alert.title}</div>
                    <div className="muted">{alert.body}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </aside>

        <section className="panel run-main">
          {selectedStatus && selectedRun ? (
            <>
              <div className="run-head">
                <div>
                  <div className="work-title">
                    <Badge tone={statusTone(selectedRun.state)}>{selectedRun.state}</Badge>
                    {isDebug ? <Badge tone="warn">debug</Badge> : null}
                    <h2>Run #{selectedRun.id}</h2>
                    <span className="muted">{selectedRun.target}</span>
                  </div>
                  <div className="muted">{short(selectedRun.prompt, 180)}</div>
                </div>
                <div className="run-head-actions">
                  <div className="chips">
                    {selectedStatus.stepCount ? (
                      <span className="chip">
                        {doneStepCount(selectedStatus.steps)}/{selectedStatus.stepCount} steps
                      </span>
                    ) : null}
                    <span className="chip">{selectedRun.pipeline_ref}</span>
                    {selectedRun.enforcement === 'strict' ? (
                      <span className="chip chip-warn">strict</span>
                    ) : null}
                  </div>
                  {isDebug ? (
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => onOpenReview(selectedRun.id)}
                    >
                      Continue on Review
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => void cancel()}
                    disabled={busy || !isActiveRun(selectedRun)}
                  >
                    <Icon name="stop" size={14} />
                    Cancel run
                  </button>
                </div>
              </div>

              <div className="grid three">
                <Field label="Host files" value={hostWorkspace || '—'} />
                <Field label="Engine workspace" value={selectedRun.workspace} />
                <Field label="Origin" value={originText(selectedRun)} />
                <Field label="Created" value={dateTime(selectedRun.created_at)} />
                <Field
                  label="Finished"
                  value={selectedRun.finished_at ? dateTime(selectedRun.finished_at) : '—'}
                />
                <Field label="Hash" value={selectedRun.hash.slice(0, 20)} />
                <Field label="Tokens" value={formatTokens(totals.tokens)} />
                <Field label="Calls" value={totals.calls} />
              </div>
              {selectedRun.error ? <div className="banner bad">{selectedRun.error}</div> : null}

              <div className="panel-head">
                <h3>Current step</h3>
                <span className="muted">read-only</span>
              </div>
              <div className="run-current">
                {step ? (
                  <>
                    <div className="work-title">
                      <Badge tone={statusTone(step.status)}>{step.status}</Badge>
                      <strong>{step.name}</strong>
                      <code>{step.path}</code>
                      <span className="muted">
                        attempt {step.attempt}/{step.max_attempts} ·{' '}
                        {modelLabel(step.model, step.provider)}
                      </span>
                    </div>
                    {currentWork ? (
                      <pre className="prompt small">{currentWork.order.prompt}</pre>
                    ) : null}
                  </>
                ) : (
                  <div className="empty">
                    {selectedRun.state === 'completed'
                      ? 'Run complete.'
                      : selectedRun.state === 'failed'
                        ? 'Run failed.'
                        : 'No current step.'}
                  </div>
                )}
                <div className="muted">
                  {isDebug
                    ? 'Step through and complete this run in the Debug dock on Review.'
                    : `Owned by ${originText(selectedRun)}. This page only observes it.`}
                </div>
              </div>

              <div className="panel-head">
                <h3>Steps</h3>
                <span className="muted">click a step for its result, lease, and usage</span>
              </div>
              <RunTree
                steps={selectedStatus.steps}
                selected={selectedStep}
                onSelect={(entry: StepSummary) => setSelectedStep(entry.path)}
              />
              <RunStepDetail step={stepDetail ?? undefined} />

              {selectedStatus.children.length ? (
                <>
                  <div className="panel-head">
                    <h3>Child runs</h3>
                  </div>
                  <div className="children">
                    {selectedStatus.children.map((child) => (
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
                  Events{' '}
                  <span className="muted">
                    ({stream.events.filter((event) => event.run_id === selectedID).length})
                  </span>
                </summary>
                <RunEvents events={stream.events.filter((event) => event.run_id === selectedID)} />
              </details>

              <details className="panel advanced-panel">
                <summary>Recovery controls</summary>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void tick()}
                    disabled={busy}
                  >
                    Watchdog tick
                  </button>
                </div>
                <div className="muted">
                  Repairs stalled steps and expired leases. Heartbeat and lease controls live in the
                  Debug dock on Review.
                </div>
              </details>
            </>
          ) : (
            <div className="run-empty">
              <Icon name="runs" size={28} />
              <h2>
                {visible.length
                  ? 'Select a run'
                  : debug.length && !showDebugRuns
                    ? 'Debug runs are hidden'
                    : 'No runs yet'}
              </h2>
              <p className="muted">
                {visible.length
                  ? 'Choose a run from the list to inspect its steps, work orders, and events.'
                  : debug.length && !showDebugRuns
                    ? 'This page shows owned runs by default. Show debug runs to inspect lab tests.'
                    : 'Start a debug run from the Debug dock on Review.'}
              </p>
              {debug.length && !showDebugRuns ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => onShowDebugRunsChange(true)}
                >
                  Show debug runs ({debug.length})
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function doneStepCount(steps: StepSummary[]): number {
  return steps.filter(
    (step) =>
      (step.type === 'agent' || step.type === 'router' || step.type === 'script') &&
      (step.status === 'done' || step.status === 'skipped')
  ).length
}
