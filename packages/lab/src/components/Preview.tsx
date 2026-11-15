import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Empty } from './Badge'
import { Card } from '@clara/ui/components/card'
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
import { Diagnostics } from './Diagnostics'
import { Icon } from './Icon'
import { Inspector } from './Inspector'
import { CompiledTree } from './StepTree'
import { SourceView } from './SourceView'
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

  const diagnostics = result?.diagnostics ?? []
  const compiled = result?.compiled
  const entry = result?.targets.find((item) => item.ref === '')
  const otherTargets = result?.targets.filter((item) => item.ref !== '') ?? []
  const pipelineInfo =
    target === ''
      ? result?.selected
      : (otherTargets.find((item) => item.ref === target) ?? result?.selected)
  const friendly = error ? friendlyError(error, 'host') : null

  return (
    <div className="view preview-view">
      <div className="review-scroll">
        <header className="view-head">
          <div>
            <div className="view-kicker">Author</div>
            <h1>Review pipeline</h1>
            <p className="muted">
              Inspect the compiled tree, catch configuration mistakes, and step through a debug run
              from the dock below.
            </p>
          </div>
          <div className="view-head-actions">
            {reloaded ? <Badge tone="ok">files changed · reloaded</Badge> : null}
            <Button
              type="button"
              onClick={() => {
                setCompareOpen((value) => !value)
                if (!compareOpen && !runs.length) void loadRuns()
              }}
              variant="outline"
            >
              Compare run
            </Button>
            <Button
              type="button"
              onClick={() => setDebugSignal((value) => value + 1)}
              disabled={!compiled}
              variant="default"
            >
              <Icon name="play" size={14} />
              Run this pipeline
            </Button>
          </div>
        </header>

        <div className="toolbar review-toolbar">
          <label className="grow">
            Pipeline
            <Select value={target || undefined} onValueChange={chooseTarget} disabled={!result}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={entry?.label ?? 'Package entry'} />
              </SelectTrigger>
              <SelectContent>
                {otherTargets.map((item) => (
                  <SelectItem key={item.ref} value={item.ref}>
                    {item.label}
                  </SelectItem>
                ))}
                {target && !otherTargets.some((item) => item.ref === target) ? (
                  <SelectItem value={target}>{target}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </label>
          <Button
            type="button"
            onClick={() => void load(hostWorkspace, target)}
            disabled={loading || !hostWorkspace}
            variant="outline"
          >
            <Icon name="refresh" size={14} />
            {loading ? 'Loading…' : 'Reload'}
          </Button>
        </div>

        {!hostWorkspace ? (
          <Notice tone="warning">
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

        {pipelineInfo ? (
          <div className="pipeline-summary">
            <strong>{pipelineInfo.label}</strong>
            {pipelineInfo.description ? <span>{pipelineInfo.description}</span> : null}
            {!target ? (
              <span className="muted">Entry router — it chooses a pipeline at runtime.</span>
            ) : null}
            {compiled?.root.enforcement ? (
              <Badge tone={compiled.root.enforcement === 'strict' ? 'warn' : 'idle'}>
                {compiled.root.enforcement}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {friendly ? (
          <Notice tone="danger" title={`${friendly.title}.`}>
            {friendly.detail}
            {friendly.hint ? <div className="mt-1 text-xs">{friendly.hint}</div> : null}
          </Notice>
        ) : null}

        <div className="preview-grid">
          <Card asChild>
            <aside className="packages">
              <div className="mb-2 flex items-start justify-between gap-2.5">
                <h3>Packages</h3>
                <span className="muted">{result?.catalog?.packages.length ?? 0}</span>
              </div>
              {result?.catalog ? (
                <div className="package-list">
                  {result.catalog.packages.map((pkg) => (
                    <details key={pkg.dir} open={pkg.namespace === undefined}>
                      <summary>
                        <strong>{pkg.namespace ? `${pkg.namespace}:${pkg.alias}` : pkg.id}</strong>
                        <span className="muted">v{pkg.version}</span>
                      </summary>
                      <div className="package-meta">
                        <div>{pkg.name}</div>
                        <div className="muted">{pkg.dir}</div>
                      </div>
                      {pkg.pipelines.length ? (
                        <div className="package-group">
                          <span className="group-label">pipelines</span>
                          {pkg.pipelines.map((pipeline) => {
                            const ref =
                              pkg.namespace && pkg.alias
                                ? `${pkg.namespace}:${pkg.alias}/${pipeline.id}`
                                : pipeline.id
                            return (
                              <button
                                key={pipeline.id}
                                type="button"
                                className={`link ${target === ref ? 'active' : ''}`}
                                onClick={() => chooseTarget(ref)}
                              >
                                {pipeline.id}
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                      {pkg.routers.length ? (
                        <div className="package-group">
                          <span className="group-label">routers</span>
                          <span className="muted">{pkg.routers.map((r) => r.id).join(', ')}</span>
                        </div>
                      ) : null}
                      {pkg.agents.length ? (
                        <div className="package-group">
                          <span className="group-label">agents</span>
                          <span className="muted">{pkg.agents.map((t) => t.name).join(', ')}</span>
                        </div>
                      ) : null}
                      {pkg.scripts.length ? (
                        <div className="package-group">
                          <span className="group-label">scripts</span>
                          <span className="muted">{pkg.scripts.map((t) => t.name).join(', ')}</span>
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              ) : (
                <Empty>Load a workspace to see its packages.</Empty>
              )}
            </aside>
          </Card>

          <Card asChild>
            <section className="tree-panel">
              <div className="mb-2 flex items-start justify-between gap-2.5">
                <h3>
                  {compiled
                    ? (result?.selected?.label ?? 'Compiled pipeline')
                    : 'Compiled pipeline'}
                </h3>
                {compiled ? <code className="hash">{compiled.hash}</code> : null}
              </div>
              {result?.stats ? (
                <div className="stats">
                  <span>{result.stats.nodes} nodes</span>
                  <span>{result.stats.agents} agents</span>
                  <span>{result.stats.scripts} scripts</span>
                  <span>{result.stats.routers} routers</span>
                  <span>{result.stats.routes} routes</span>
                  <span>{result.stats.groups} groups</span>
                </div>
              ) : null}
              <Diagnostics diagnostics={diagnostics} onOpenSource={setSourcePath} />
              {sourcePath ? (
                <div className="source-drawer">
                  <div className="row-between">
                    <strong>Source</strong>
                    <Button
                      type="button"
                      onClick={() => setSourcePath(undefined)}
                      variant="ghost"
                      size="xs"
                    >
                      Close
                    </Button>
                  </div>
                  <SourceView path={sourcePath} />
                </div>
              ) : null}
              {compiled ? (
                <CompiledTree
                  root={compiled.root}
                  selected={selected?.path}
                  onSelect={setSelected}
                />
              ) : (
                <Empty>Fix the diagnostics above to compile this target.</Empty>
              )}
            </section>
          </Card>

          <Card asChild>
            <section className="inspector-panel">
              <Inspector node={selected} root={result?.compiled?.root} />
            </section>
          </Card>
        </div>

        {compareOpen ? (
          <Card asChild>
            <section className="compare">
              <div className="section-head">
                <div>
                  <h2>Compare with a pinned run</h2>
                  <p className="muted">Current files against the snapshot a run started with.</p>
                </div>
                <Button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  variant="ghost"
                  size="xs"
                >
                  <Icon name="close" size={14} />
                  Close
                </Button>
              </div>
              <div className="compare-body">
                <div className="row">
                  <Select
                    value={runID ? String(runID) : undefined}
                    onValueChange={(value) => setRunID(Number(value))}
                  >
                    <SelectTrigger>
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
                              <Badge
                                tone={
                                  change.kind === 'added'
                                    ? 'ok'
                                    : change.kind === 'removed'
                                      ? 'bad'
                                      : 'warn'
                                }
                              >
                                {change.kind}
                              </Badge>
                              <code>{change.path}</code>
                              {compiled ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  className="inline h-auto p-0 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    const node = findCompiledNode(compiled.root, change.path)
                                    if (node) setSelected(node)
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
                      <Empty>The current files match the pinned run snapshot.</Empty>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </Card>
        ) : null}
      </div>

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
      />
    </div>
  )
}
