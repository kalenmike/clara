import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@clara/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import { Notice } from '@clara/ui/patterns/notice'
import { Button } from '@clara/ui/components/button'
import { ApiError, getDiff, getRuns, preview, type DiffResponse } from '../api'
import type { CompiledNode, LabPreviewResult, PreflightResult, RunRow } from '../types'
import type { LabStream } from '../useLab'
import { DebugDock } from './DebugDock'
import { DetailPanel } from './DetailPanel'
import { Diagnostics } from './Diagnostics'
import { Icon } from './Icon'
import { PipelineGraph } from './PipelineGraph'
import { PipelineTree } from './PipelineTree'
import { short } from '../lib/format'
import { friendlyError } from '../lib/errors'
import { isDebugRun } from '../lib/runs'
import { findCompiledNode } from '../lib/tree'

export function Preview({
  stream,
  hostWorkspace,
  runtimeWorkspace,
  target,
  onTargetChange,
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
}: {
  stream: LabStream
  hostWorkspace: string
  runtimeWorkspace: string
  target: string
  onTargetChange: (target: string) => void
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
}) {
  const [result, setResult] = useState<LabPreviewResult | null>(null)
  const [selected, setSelected] = useState<CompiledNode | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloaded, setReloaded] = useState(false)
  const [sourcePath, setSourcePath] = useState<string | undefined>()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [runID, setRunID] = useState<number | undefined>()
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [debugSignal, setDebugSignal] = useState(0)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  const seenPreview = useRef(0)

  const load = useCallback(async (nextWorkspace: string, nextTarget: string) => {
    setLoading(true)
    setError(null)
    setDiff(null)
    try {
      const value = await preview({
        workspace: nextWorkspace,
        ...(nextTarget ? { target: nextTarget } : {}),
      })
      setResult(value)
      setSelected((current) => {
        if (!value.compiled) return undefined
        if (!current) return value.compiled.root
        return findCompiledNode(value.compiled.root, current.path) ?? value.compiled.root
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active || !hostWorkspace) return
    const timer = window.setTimeout(() => void load(hostWorkspace, target), 350)
    return () => window.clearTimeout(timer)
  }, [active, hostWorkspace, target, load])

  useEffect(() => {
    if (!seenPreview.current) {
      seenPreview.current = stream.previewRevision
      return
    }
    if (stream.previewRevision === seenPreview.current) return
    seenPreview.current = stream.previewRevision
    if (!active || !hostWorkspace) return
    void load(hostWorkspace, target).then(() => {
      setReloaded(true)
      window.setTimeout(() => setReloaded(false), 1800)
    })
  }, [stream.previewRevision, active, hostWorkspace, target, load])

  const chooseTarget = (value: string): void => {
    onTargetChange(value)
  }

  const loadRuns = async (): Promise<void> => {
    try {
      const value = await getRuns()
      const list = Array.isArray(value.value) ? value.value : []
      setRuns(list)
      if (list.length && runID === undefined) setRunID(list[0].id)
    } catch (cause) {
      setDiffError(cause instanceof ApiError ? cause.message : String(cause))
    }
  }

  const compare = async (): Promise<void> => {
    if (!runID) return
    setDiffLoading(true)
    setDiffError(null)
    try {
      const value = await getDiff({
        run_id: runID,
        workspace: hostWorkspace,
        ...(target ? { target } : {}),
      })
      setDiff(value)
    } catch (cause) {
      setDiffError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDiffLoading(false)
    }
  }

  const selectNode = (node: CompiledNode): void => {
    setSelected(node)
    setSourcePath(undefined)
    setDetailOpen(true)
  }

  const diagnostics = result?.diagnostics ?? []
  const compiled = result?.compiled
  const otherTargets = result?.targets.filter((item) => item.ref !== '') ?? []
  const pipelineInfo =
    target === ''
      ? result?.selected
      : (otherTargets.find((item) => item.ref === target) ?? result?.selected)
  const wrapperPreview = pipelineInfo?.kind === 'wrapper'
  const friendly = error ? friendlyError(error, 'host') : null
  const errorCount = diagnostics.filter((item) => item.severity === 'error').length
  const warningCount = diagnostics.filter((item) => item.severity === 'warning').length

  useEffect(() => {
    if (errorCount) setDiagnosticsOpen(true)
  }, [errorCount])

  return (
    <div className="view preview-view flex h-full min-h-0 max-w-none flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <div className="view-kicker">Review</div>
          <h1>Pipeline review</h1>
          <p className="text-xs text-muted-foreground">
            {wrapperPreview
              ? 'Wrapper preview — the routed pipeline runs in the slot at runtime.'
              : (pipelineInfo?.description ??
                'Inspect the compiled graph, select a step, and drive a debug run below.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reloaded ? (
            <span className="rounded-full border border-status-success/40 bg-status-success/10 px-2 py-1 text-[10px] text-status-success">
              files changed · reloaded
            </span>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              setCompareOpen(true)
              if (!runs.length) void loadRuns()
            }}
            disabled={wrapperPreview}
            title={
              wrapperPreview
                ? 'Wrapper previews run with the routed pipeline in place of the slot.'
                : undefined
            }
            variant="outline"
          >
            Compare run
          </Button>
          <Button
            type="button"
            onClick={() => void load(hostWorkspace, target)}
            disabled={loading || !hostWorkspace}
            variant="outline"
          >
            <Icon name="refresh" size={14} />
            {loading ? 'Loading…' : 'Reload'}
          </Button>
          <Button
            type="button"
            onClick={() => setDebugSignal((value) => value + 1)}
            disabled={!compiled || wrapperPreview}
            title={
              wrapperPreview
                ? 'Select a pipeline target to start a run; the wrapper is applied by the router.'
                : undefined
            }
            variant="default"
          >
            <Icon name="play" size={14} />
            Run this pipeline
          </Button>
        </div>
      </header>

      {!hostWorkspace ? (
        <Notice tone="warning" className="mb-2 shrink-0">
          No workspace selected.{' '}
          <Button
            type="button"
            variant="link"
            className="inline h-auto p-0 text-sm"
            onClick={onOpenSettings}
          >
            Choose one in Settings
          </Button>
          .
        </Notice>
      ) : null}

      {friendly ? (
        <Notice tone="danger" title={`${friendly.title}.`} className="mb-2 shrink-0">
          {friendly.detail}
          {friendly.hint ? <div className="mt-1 text-xs">{friendly.hint}</div> : null}
        </Notice>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        <PipelineTree
          packages={result?.catalog?.packages ?? []}
          targets={result?.targets ?? []}
          selected={target}
          onSelect={chooseTarget}
          collapsed={treeCollapsed}
          onToggle={() => setTreeCollapsed((value) => !value)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">
                {compiled ? (pipelineInfo?.label ?? 'Compiled pipeline') : 'Compiled pipeline'}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                {target === '' ? <span>Entry router — chooses a pipeline at runtime.</span> : null}
                {wrapperPreview ? (
                  <span>
                    Wrapper-only preview — the routed pipeline replaces the slot at runtime.
                  </span>
                ) : null}
                {pipelineInfo?.wrappedBy && target ? (
                  <span title="Explicit targets run directly; preview the entry to see the wrapper.">
                    Routed wrap: <code>{pipelineInfo.wrappedBy}</code>
                  </span>
                ) : null}
                {compiled ? <code className="font-mono">{compiled.hash}</code> : null}
                {result?.stats ? (
                  <span>
                    {result.stats.nodes} nodes · {result.stats.agents} agents ·{' '}
                    {result.stats.scripts} scripts · {result.stats.routes} routes
                  </span>
                ) : null}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {diagnostics.length ? (
                <button
                  type="button"
                  className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setDiagnosticsOpen((value) => !value)}
                  aria-expanded={diagnosticsOpen}
                >
                  {diagnosticsOpen ? 'Hide diagnostics' : 'Diagnostics'}
                </button>
              ) : null}
              {errorCount ? (
                <button
                  type="button"
                  className="rounded-full border border-status-danger/40 bg-status-danger/10 px-2 py-0.5 text-[10px] text-status-danger"
                  onClick={() => setDiagnosticsOpen(true)}
                >
                  {errorCount} error{errorCount === 1 ? '' : 's'}
                </button>
              ) : null}
              {warningCount ? (
                <button
                  type="button"
                  className="rounded-full border border-status-warning/40 bg-status-warning/10 px-2 py-0.5 text-[10px] text-status-warning"
                  onClick={() => setDiagnosticsOpen(true)}
                >
                  {warningCount} warning{warningCount === 1 ? '' : 's'}
                </button>
              ) : null}
              {compiled?.root.enforcement ? (
                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {compiled.root.enforcement}
                </span>
              ) : null}
            </div>
          </div>

          {diagnostics.length && diagnosticsOpen ? (
            <div className="max-h-40 shrink-0 overflow-auto border-b px-3 py-2">
              <Diagnostics
                diagnostics={diagnostics}
                onOpenSource={(path) => {
                  setSourcePath(path)
                  setDetailOpen(true)
                }}
              />
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            {compiled ? (
              <PipelineGraph
                root={compiled.root}
                packages={result?.catalog?.packages ?? []}
                selected={selected}
                onSelect={selectNode}
                rootBadge={wrapperPreview ? '' : 'Entry'}
              />
            ) : (
              <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
                Fix the diagnostics above to compile this target.
              </div>
            )}
          </div>
        </div>
      </div>

      <DetailPanel
        node={selected}
        root={compiled?.root}
        collapsed={!detailOpen}
        onToggle={() => setDetailOpen((value) => !value)}
        sourceOverride={sourcePath}
        onClearSource={() => setSourcePath(undefined)}
        onSelectNode={selectNode}
      />

      <DebugDock
        stream={stream}
        runtimeWorkspace={runtimeWorkspace}
        target={target}
        pauseAfterStep={pauseAfterStep}
        onPauseAfterStepChange={onPauseAfterStepChange}
        active={active}
        preflight={preflight}
        onPreflight={onPreflight}
        onOpenSettings={onOpenSettings}
        onNotice={onNotice}
        onOpenRun={onOpenRun}
        focusRunID={focusRunID}
        onFocusHandled={onFocusHandled}
        expandSignal={debugSignal}
        runnable={!wrapperPreview}
      />

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Compare with a pinned run</DialogTitle>
            <DialogDescription>
              Current files against the snapshot a run started with.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={runID ? String(runID) : undefined}
              onValueChange={(value) => setRunID(Number(value))}
            >
              <SelectTrigger className="min-w-64">
                <SelectValue placeholder="Select a run…" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={String(run.id)}>
                    #{run.id} {run.target} · {run.state}
                    {isDebugRun(run) ? ' · debug' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={() => void loadRuns()} variant="outline">
              Refresh runs
            </Button>
            <Button
              type="button"
              onClick={() => void compare()}
              disabled={!runID || diffLoading}
              variant="default"
            >
              {diffLoading ? 'Comparing…' : 'Compare'}
            </Button>
          </div>
          {diffError ? <Notice tone="danger">{diffError}</Notice> : null}
          {diff ? (
            <div className="diff">
              <div className="stats">
                <span>current {short(diff.currentHash, 22)}</span>
                <span>run {short(diff.runHash ?? '—', 22)}</span>
                <span>{diff.diff.summary.added} added</span>
                <span>{diff.diff.summary.removed} removed</span>
                <span>{diff.diff.summary.changed} changed</span>
                <span>{diff.diff.summary.unchanged} unchanged</span>
              </div>
              {diff.diff.changes.length ? (
                <div className="diff-list">
                  {diff.diff.changes.map((change) => (
                    <details key={change.path} className={`diff-item diff-${change.kind}`}>
                      <summary>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            change.kind === 'added'
                              ? 'border-status-success/40 text-status-success'
                              : change.kind === 'removed'
                                ? 'border-status-danger/40 text-status-danger'
                                : 'border-status-warning/40 text-status-warning'
                          }`}
                        >
                          {change.kind}
                        </span>
                        <code>{change.path}</code>
                        {compiled ? (
                          <Button
                            type="button"
                            variant="link"
                            className="inline h-auto p-0 text-xs"
                            onClick={(event) => {
                              event.preventDefault()
                              const node = findCompiledNode(compiled.root, change.path)
                              if (node) {
                                selectNode(node)
                                setCompareOpen(false)
                              }
                            }}
                          >
                            select
                          </Button>
                        ) : null}
                      </summary>
                      {change.fields.length ? (
                        <div className="field-diff">
                          {change.fields.map((field) => (
                            <div key={field.field} className="field-diff-row">
                              <strong>{field.field}</strong>
                              <div className="field-diff-value">
                                <span className="muted">run</span> {short(field.before, 220)}
                              </div>
                              <div className="field-diff-value">
                                <span className="muted">now</span> {short(field.after, 220)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  The current files match the pinned run snapshot.
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
