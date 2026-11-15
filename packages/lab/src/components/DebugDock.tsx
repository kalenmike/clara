import { useCallback, useEffect, useRef, useState } from 'react'
import { Empty } from './Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import { Textarea } from '@clara/ui/components/textarea'
import { Checkbox } from '@clara/ui/components/checkbox'
import { Notice } from '@clara/ui/patterns/notice'
import { Button } from '@clara/ui/components/button'
import { callTool, getRun, getRuns, registerAdapter, setHeartbeat } from '../api'
import type { LabStream } from '../useLab'
import type { PreflightResult, RunRow, StatusResult } from '../types'
import { friendlyError } from '../lib/errors'
import { dateTime, short, statusTone } from '../lib/format'
import {
  debugRuns as onlyDebugRuns,
  isActiveRun,
  isDebugRun,
  latestActiveRun,
  sortRuns,
} from '../lib/runs'
import { Badge } from './Badge'
import { Icon } from './Icon'
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

export function DebugDock({
  stream,
  runtimeWorkspace,
  target,
  pauseAfterStep,
  onPauseAfterStepChange,
  active,
  preflight,
  onPreflight,
  onOpenSettings,
  onNotice,
  onOpenRun,
  focusRunID,
  onFocusHandled,
  expandSignal,
}: {
  stream: LabStream
  runtimeWorkspace: string
  target: string
  pauseAfterStep: boolean
  onPauseAfterStepChange: (value: boolean) => void
  active: boolean
  preflight: PreflightResult | null
  onPreflight: () => void
  onOpenSettings: () => void
  onNotice: (message: string) => void
  onOpenRun: (runID: number) => void
  focusRunID?: number
  onFocusHandled: () => void
  expandSignal: number
}) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedID, setSelectedID] = useState<number | undefined>()
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const promptRef = useRef<HTMLTextAreaElement>(null)
  const seenExpand = useRef(0)

  const refreshRuns = useCallback(async () => {
    try {
      const result = await getRuns()
      const list = Array.isArray(result.value) ? (result.value as RunRow[]) : []
      setRuns(list)
      setSelectedID((current) => {
        const debug = onlyDebugRuns(list)
        if (current && debug.some((run) => run.id === current)) return current
        return latestActiveRun(debug)?.id
      })
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  const refreshStatus = useCallback(async (id: number) => {
    try {
      const result = await getRun(id)
      if (!result.value || typeof result.value !== 'object') return
      setStatus(result.value as StatusResult)
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
    if (!expandSignal || expandSignal === seenExpand.current) return
    seenExpand.current = expandSignal
    setOpen(true)
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }, [expandSignal])

  useEffect(() => {
    if (!focusRunID || !runs.length) return
    const run = runs.find((entry) => entry.id === focusRunID)
    if (!run || !isDebugRun(run)) {
      onFocusHandled()
      return
    }
    setSelectedID(run.id)
    setOpen(true)
    onFocusHandled()
  }, [focusRunID, runs, onFocusHandled])

  const debug = sortRuns(onlyDebugRuns(runs))
  const selectedStatus = status && status.run.id === selectedID ? status : null
  const selected = selectedStatus?.run ?? debug.find((run) => run.id === selectedID)
  const work = (stream.snapshot?.work ?? []).filter(
    (record) => !selectedID || record.order.run_id === selectedID
  )
  const heartbeat = stream.snapshot?.heartbeat ?? true
  const stepRows =
    selectedStatus?.steps.filter(
      (entry) => entry.type === 'agent' || entry.type === 'router' || entry.type === 'script'
    ) ?? []
  const doneSteps = stepRows.filter(
    (entry) => entry.status === 'done' || entry.status === 'skipped'
  ).length
  const totalSteps = selectedStatus?.stepCount
  const currentStep =
    selectedStatus?.steps.find((entry) => entry.status === 'running') ??
    selectedStatus?.steps.find((entry) => entry.status === 'waiting') ??
    selectedStatus?.steps.find(
      (entry) => entry.type === 'agent' || entry.type === 'router' || entry.type === 'script'
    )
  const currentActive = selected ? isActiveRun(selected) : false
  const friendly = error ? friendlyError(error, 'start') : null

  const start = async (): Promise<void> => {
    if (!prompt.trim()) {
      setError('Enter a prompt before starting a debug run.')
      return
    }
    if (!runtimeWorkspace.trim()) {
      setError('The engine has not reported its workspace yet. Reconnect in Settings.')
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
        setOpen(true)
        onNotice(`Started debug run #${run.id}.`)
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

  const cancel = async (): Promise<void> => {
    if (!selectedID) return
    if (!window.confirm(`Cancel debug run #${selectedID} and all of its children?`)) return
    setBusy(true)
    setError(null)
    try {
      await callTool('clara_cancel', {
        run_id: selectedID,
        reason: 'cancelled from Clara Lab review',
      })
      await refreshStatus(selectedID)
      await refreshRuns()
      onNotice(`Debug run #${selectedID} cancelled.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggleHeartbeat = async (): Promise<void> => {
    try {
      await setHeartbeat(!(stream.snapshot?.heartbeat ?? true))
    } catch (cause) {
      setError(message(cause))
    }
  }

  return (
    <section className={`debug-dock panel ${open ? 'open' : 'collapsed'}`}>
      <header className="debug-dock-head">
        <div className="debug-dock-title">
          <span className="view-kicker">Debug</span>
          <div className="debug-dock-title-row">
            <h2>Test run</h2>
            {selected ? <Badge tone={statusTone(selected.state)}>{selected.state}</Badge> : null}
            {selected && isDebugRun(selected) ? <Badge tone="warn">debug</Badge> : null}
            {totalSteps ? (
              <span className="chip">
                {doneSteps}/{totalSteps} steps
              </span>
            ) : selected ? (
              <span className="chip">
                {doneSteps} step{doneSteps === 1 ? '' : 's'} done
              </span>
            ) : null}
          </div>
          <p className="muted">
            Start a lab run and step through it here. Runs is for read-only observation.
          </p>
        </div>
        <div className="debug-dock-actions">
          {selectedID ? (
            <Button type="button" onClick={() => onOpenRun(selectedID)} variant="ghost" size="xs">
              Open in Runs
            </Button>
          ) : null}
          <Button type="button" onClick={() => setOpen(!open)} variant="ghost" size="xs">
            {open ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </header>

      {open ? (
        <div className="debug-dock-body">
          <section className="run-start debug-launch">
            <div className="run-start-head">
              <div>
                <h3>Start a debug run</h3>
                <p className="muted">
                  Target <strong>{target || 'Entry router'}</strong> · workspace{' '}
                  <code>{runtimeWorkspace || 'waiting for the engine'}</code>
                </p>
              </div>
            </div>
            <div className="run-start-row">
              <Textarea
                ref={promptRef}
                rows={2}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What should the pipeline work on?"
              />
              <Button
                type="button"
                onClick={() => void start()}
                disabled={busy || !prompt.trim()}
                className="run-start-button"
                variant="default"
              >
                <Icon name="play" size={14} />
                Start debug run
              </Button>
            </div>
            <div className="run-start-meta">
              <label className="check">
                <Checkbox
                  checked={pauseAfterStep}
                  onCheckedChange={(value) => onPauseAfterStepChange(value === true)}
                />
                Pause after each step
              </label>
              <span className="muted">
                Origin is recorded as <code>clara-lab / lab / agent</code>.
              </span>
              {preflight?.host.strict && !preflight.adapter.ok ? (
                <span className="tone-warn">
                  This pipeline is strict. The lab will register its adapter when you start.{' '}
                  <Button
                    type="button"
                    variant="link"
                    className="inline h-auto p-0 text-inherit"
                    onClick={onOpenSettings}
                  >
                    Settings
                  </Button>
                </span>
              ) : null}
            </div>
          </section>

          {friendly ? (
            <Notice tone="danger" title={`${friendly.title}.`}>
              {friendly.detail}
              {friendly.hint ? <div className="mt-1 text-xs">{friendly.hint}</div> : null}
            </Notice>
          ) : null}

          {debug.length ? (
            <div className="debug-run-picker">
              <label>
                Debug run
                <Select
                  value={selectedID ? String(selectedID) : undefined}
                  onValueChange={(value) => setSelectedID(Number(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a debug run…" />
                  </SelectTrigger>
                  <SelectContent>
                    {debug.map((run) => (
                      <SelectItem key={run.id} value={String(run.id)}>
                        #{run.id} {run.target} · {run.state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {selected ? (
                <div className="chips">
                  <span className="chip">{selected.pipeline_ref}</span>
                  <span className="chip">{dateTime(selected.created_at)}</span>
                  {selected.hash ? (
                    <span className="chip">pinned {selected.hash.slice(0, 12)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedStatus && selected ? (
            <>
              <div className="debug-run-head">
                <div>
                  <div className="work-title">
                    <h3>Run #{selected.id}</h3>
                    <span className="muted">{selected.target}</span>
                  </div>
                  <div className="muted">{short(selected.prompt, 180)}</div>
                </div>
                <div className="debug-run-actions">
                  {currentStep ? (
                    <span className="chip">
                      {currentStep.name} · {currentStep.status}
                    </span>
                  ) : (
                    <span className="chip">no current step</span>
                  )}
                  {currentActive ? (
                    <Button
                      type="button"
                      onClick={() => void pullNext(selected.id)}
                      disabled={busy}
                      variant="ghost"
                      size="xs"
                    >
                      Pull next
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => void cancel()}
                    disabled={busy || !currentActive}
                    variant="destructive"
                    size="xs"
                  >
                    <Icon name="stop" size={13} />
                    Cancel run
                  </Button>
                </div>
              </div>

              {selectedStatus.run.error ? (
                <Notice tone="danger">{selectedStatus.run.error}</Notice>
              ) : null}

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
                <Empty>
                  {currentActive
                    ? 'No step is claimed. Use Pull next to claim ready work.'
                    : selectedStatus.run.state === 'completed'
                      ? 'Run complete. Start another debug run or open this one in Runs.'
                      : `Run ${selectedStatus.run.state}.`}
                </Empty>
              )}

              <details className="advanced-panel debug-advanced">
                <summary>Harness controls</summary>
                <div className="actions">
                  <Button
                    type="button"
                    onClick={() => void toggleHeartbeat()}
                    variant="outline"
                    size="xs"
                  >
                    {heartbeat ? 'Pause heartbeats' : 'Resume heartbeats'}
                  </Button>
                </div>
                <div className="muted">
                  Heartbeat holds the lease while you type. Pausing it lets the watchdog retry the
                  step after the stall threshold.
                </div>
              </details>
            </>
          ) : (
            <div className="debug-empty">
              <Icon name="runs" size={22} />
              <span>
                {debug.length
                  ? 'Start a debug run above, or pick an earlier run from the dropdown.'
                  : 'Start a debug run above to claim the first work order.'}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
