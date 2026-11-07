import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getDiff, getRuns, preview, type DiffResponse } from '../api'
import type { CompiledNode, PreviewResult, RunRow } from '../types'
import type { LabStream } from '../useLab'
import { Badge } from './Badge'
import { Diagnostics } from './Diagnostics'
import { Inspector } from './Inspector'
import { CompiledTree } from './StepTree'
import { SourceView } from './SourceView'
import { short } from '../lib/format'
import { findCompiledNode } from '../lib/tree'

export function Preview({
  stream,
  onUseTarget,
}: {
  stream: LabStream
  onUseTarget: (target: string) => void
}) {
  const [workspace, setWorkspace] = useState(stream.snapshot?.workspace ?? '')
  const [target, setTarget] = useState('')
  const [result, setResult] = useState<PreviewResult | null>(null)
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

  const booted = useRef(false)
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
      setSelected(value.compiled?.root)
      if (value.workspace) setWorkspace(value.workspace.workspace)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (booted.current || !stream.snapshot) return
    booted.current = true
    const initial = stream.snapshot.workspace
    setWorkspace(initial)
    void load(initial, '')
  }, [stream.snapshot, load])

  useEffect(() => {
    if (!seenPreview.current) {
      seenPreview.current = stream.previewRevision
      return
    }
    if (stream.previewRevision === seenPreview.current) return
    seenPreview.current = stream.previewRevision
    if (!workspace) return
    void load(workspace, target).then(() => {
      setReloaded(true)
      window.setTimeout(() => setReloaded(false), 1800)
    })
  }, [stream.previewRevision, workspace, target, load])

  const chooseTarget = (value: string): void => {
    setTarget(value)
    void load(workspace, value)
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
        workspace,
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

  return (
    <div className="preview">
      <div className="toolbar">
        <label className="grow">
          Workspace
          <input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(workspace, target)
            }}
            placeholder="/path/to/workspace"
          />
        </label>
        <label>
          Target
          <select value={target} onChange={(event) => chooseTarget(event.target.value)}>
            <option value="">{entry?.label ?? 'Package entry'}</option>
            {otherTargets.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          onClick={() => void load(workspace, target)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => onUseTarget(target)}
          disabled={!compiled}
        >
          Use in probe
        </button>
        {reloaded ? <Badge tone="ok">files changed · reloaded</Badge> : null}
      </div>

      {error ? <div className="banner bad">{error}</div> : null}

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

      <details
        className="panel compare"
        onToggle={(event) => {
          if (event.currentTarget.open && !runs.length) void loadRuns()
        }}
      >
        <summary>
          <strong>Compare with a pinned run</strong>
          <span className="muted"> current files ↔ the snapshot a run started with</span>
        </summary>
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
      </details>
    </div>
  )
}
