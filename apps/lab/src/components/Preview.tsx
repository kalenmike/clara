import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getDiff, getRuns, preview, type DiffResponse } from '../api'
import type { CompiledNode, LabPreviewResult, RunRow } from '../types'
import type { LabStream } from '../useLab'
import { Badge } from './Badge'
import { Diagnostics } from './Diagnostics'
import { Icon } from './Icon'
import { Inspector } from './Inspector'
import { CompiledTree } from './StepTree'
import { SourceView } from './SourceView'
import { short } from '../lib/format'
import { friendlyError } from '../lib/errors'
import { findCompiledNode } from '../lib/tree'

export function Preview({
  stream,
  hostWorkspace,
  target,
  onTargetChange,
  active,
  onRun,
  onOpenSettings,
}: {
  stream: LabStream
  hostWorkspace: string
  target: string
  onTargetChange: (target: string) => void
  active: boolean
  onRun: () => void
  onOpenSettings: () => void
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
      <header className="view-head">
        <div>
          <div className="view-kicker">Author</div>
          <h1>Review pipeline</h1>
          <p className="muted">
            Inspect the compiled tree, catch configuration mistakes, and jump into source before
            starting a run.
          </p>
        </div>
        <div className="view-head-actions">
          {reloaded ? <Badge tone="ok">files changed · reloaded</Badge> : null}
          <button
            type="button"
            className="button"
            onClick={() => {
              setCompareOpen((value) => !value)
              if (!compareOpen && !runs.length) void loadRuns()
            }}
          >
            Compare run
          </button>
          <button type="button" className="button primary" onClick={onRun} disabled={!compiled}>
            <Icon name="play" size={14} />
            Run this pipeline
          </button>
        </div>
      </header>

      <div className="toolbar review-toolbar">
        <label className="grow">
          Pipeline
          <select
            value={target}
            onChange={(event) => chooseTarget(event.target.value)}
            disabled={!result}
          >
            <option value="">{entry?.label ?? 'Package entry'}</option>
            {otherTargets.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.label}
              </option>
            ))}
            {target && !otherTargets.some((item) => item.ref === target) ? (
              <option value={target}>{target}</option>
            ) : null}
          </select>
        </label>
        <button
          type="button"
          className="button"
          onClick={() => void load(hostWorkspace, target)}
          disabled={loading || !hostWorkspace}
        >
          <Icon name="refresh" size={14} />
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>

      {!hostWorkspace ? (
        <div className="banner warn">
          No workspace selected.{' '}
          <button type="button" className="link" onClick={onOpenSettings}>
            Choose one in Settings
          </button>
          .
        </div>
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
          {result?.modelCatalog ? (
            <Badge tone={result.modelCatalog.ok ? 'ok' : 'warn'}>
              {result.modelCatalog.ok
                ? `${result.modelCatalog.count} models`
                : 'models not checked'}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {friendly ? (
        <div className="banner bad">
          <strong>{friendly.title}.</strong> {friendly.detail}
          {friendly.hint ? <div className="muted">{friendly.hint}</div> : null}
        </div>
      ) : null}

      <div className="preview-grid">
        <aside className="panel packages">
          <div className="panel-head">
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
                  {pkg.tasks.length ? (
                    <div className="package-group">
                      <span className="group-label">tasks</span>
                      <span className="muted">{pkg.tasks.map((t) => t.name).join(', ')}</span>
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <div className="empty">Load a workspace to see its packages.</div>
          )}
        </aside>

        <section className="panel tree-panel">
          <div className="panel-head">
            <h3>
              {compiled ? (result?.selected?.label ?? 'Compiled pipeline') : 'Compiled pipeline'}
            </h3>
            {compiled ? <code className="hash">{compiled.hash}</code> : null}
          </div>
          {result?.stats ? (
            <div className="stats">
              <span>{result.stats.nodes} nodes</span>
              <span>{result.stats.tasks} tasks</span>
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
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setSourcePath(undefined)}
                >
                  Close
                </button>
              </div>
              <SourceView path={sourcePath} />
            </div>
          ) : null}
          {compiled ? (
            <CompiledTree root={compiled.root} selected={selected?.path} onSelect={setSelected} />
          ) : (
            <div className="empty">Fix the diagnostics above to compile this target.</div>
          )}
        </section>

        <section className="panel inspector-panel">
          <Inspector node={selected} />
        </section>
      </div>

      {compareOpen ? (
        <section className="panel compare">
          <div className="section-head">
            <div>
              <h2>Compare with a pinned run</h2>
              <p className="muted">Current files against the snapshot a run started with.</p>
            </div>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setCompareOpen(false)}
            >
              <Icon name="close" size={14} />
              Close
            </button>
          </div>
          <div className="compare-body">
            <div className="row">
              <select
                value={runID ?? ''}
                onChange={(event) => setRunID(Number(event.target.value) || undefined)}
              >
                <option value="">Select a run…</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    #{run.id} {run.target} · {run.state}
                  </option>
                ))}
              </select>
              <button type="button" className="button" onClick={() => void loadRuns()}>
                Refresh runs
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void compare()}
                disabled={!runID || diffLoading}
              >
                {diffLoading ? 'Comparing…' : 'Compare'}
              </button>
            </div>
            {diffError ? <div className="banner bad">{diffError}</div> : null}
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
                            <button
                              type="button"
                              className="link"
                              onClick={(event) => {
                                event.preventDefault()
                                const node = findCompiledNode(compiled.root, change.path)
                                if (node) setSelected(node)
                              }}
                            >
                              select
                            </button>
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
                  <div className="empty">The current files match the pinned run snapshot.</div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
