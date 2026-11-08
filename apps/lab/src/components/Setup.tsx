import type { ReactNode } from 'react'
import type { LabSnapshot, PreflightResult } from '../types'
import { friendlyError } from '../lib/errors'
import { Badge } from './Badge'

export function Setup({
  snapshot,
  hostWorkspace,
  onHostWorkspace,
  browsing,
  onBrowse,
  preflight,
  loading,
  error,
  open,
  onToggle,
  onCheck,
  onReconnect,
  onEnableAdapter,
}: {
  snapshot: LabSnapshot
  hostWorkspace: string
  onHostWorkspace: (value: string) => void
  browsing: boolean
  onBrowse: () => void
  preflight: PreflightResult | null
  loading: boolean
  error: string | null
  open: boolean
  onToggle: () => void
  onCheck: () => void
  onReconnect: () => void
  onEnableAdapter: () => void
}) {
  const runtime = snapshot.orchestratorWorkspace
  const friendly = error ? friendlyError(error, 'runtime') : null
  const ok = Boolean(
    preflight &&
    preflight.host.ok &&
    preflight.runtime.ok &&
    (!preflight.adapter.required || preflight.adapter.ok)
  )
  const summary = preflight
    ? ok
      ? 'host OK · orchestrator OK · adapter OK'
      : 'setup needs attention'
    : 'not checked yet'

  return (
    <section className="panel setup">
      <div className="setup-summary">
        <div className="setup-title">
          <h2>Setup</h2>
          <span className={`setup-pill ${ok ? 'setup-pill-ok' : 'setup-pill-warn'}`}>
            {summary}
          </span>
        </div>
        <div className="setup-actions">
          <Badge tone={snapshot.connected ? 'ok' : 'bad'}>
            {snapshot.connected ? 'connected' : 'offline'}
          </Badge>
          <Badge tone={snapshot.tokenPresent ? 'ok' : 'warn'}>
            {snapshot.tokenPresent ? 'token ready' : 'no token'}
          </Badge>
          <button type="button" className="button ghost small" onClick={onReconnect}>
            Reconnect
          </button>
          <button type="button" className="button ghost small" onClick={onToggle}>
            {open ? 'Hide' : 'Edit setup'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="setup-body">
          <div className="setup-grid">
            <label>
              Files on this machine
              <div className="path-row">
                <input
                  value={hostWorkspace}
                  onChange={(event) => onHostWorkspace(event.target.value)}
                  placeholder="/home/jet/Projects/clara"
                />
                <button
                  type="button"
                  className="button ghost small"
                  onClick={onBrowse}
                  disabled={browsing}
                >
                  {browsing ? 'Browsing…' : 'Browse…'}
                </button>
              </div>
              <span className="muted">
                The lab compiles this path. It is also where file watching and source view read.
              </span>
            </label>
            <div className="setup-readonly">
              <span>Orchestrator workspace</span>
              <code>{runtime || 'Waiting for the orchestrator…'}</code>
              <span className="muted">
                Reported by the service from <code>CLARA_ORCHESTRATION_WORKSPACE</code>. Runs use
                this path.
              </span>
            </div>
          </div>

          <div className="row">
            <button type="button" className="button primary" onClick={onCheck} disabled={loading}>
              {loading ? 'Checking…' : 'Check setup'}
            </button>
            <span className="muted">
              {snapshot.orchestrator} ·{' '}
              {runtime ? (
                <>
                  runs use <code>{runtime}</code>
                </>
              ) : (
                'waiting for the orchestrator workspace'
              )}
            </span>
          </div>

          {friendly ? (
            <div className="setup-status setup-error">
              <strong>{friendly.title}</strong>
              {friendly.detail ? <span>{friendly.detail}</span> : null}
              {friendly.hint ? <span className="muted">{friendly.hint}</span> : null}
            </div>
          ) : null}

          {preflight ? (
            <div className="preflight">
              <PreflightRow
                label="Host files"
                ok={preflight.host.ok}
                detail={
                  preflight.host.ok
                    ? `${preflight.host.packages ?? 0} packages${
                        preflight.host.targetLabel ? ` · ${preflight.host.targetLabel}` : ''
                      }`
                    : friendlyError(preflight.host.error ?? 'The host preview failed.', 'host')
                        .title
                }
                hint={
                  preflight.host.ok
                    ? preflight.host.configPath
                    : friendlyError(preflight.host.error ?? '', 'host').hint
                }
              />
              <PreflightRow
                label="Orchestrator workspace"
                ok={preflight.runtime.ok}
                detail={
                  preflight.runtime.ok
                    ? `${preflight.runtime.packages ?? 0} packages visible`
                    : friendlyError(
                        preflight.runtime.error ?? 'The orchestrator check failed.',
                        'runtime'
                      ).title
                }
                hint={
                  preflight.runtime.ok
                    ? runtime
                    : friendlyError(preflight.runtime.error ?? '', 'runtime').hint
                }
              />
              <PreflightRow
                label="Strict adapter"
                ok={!preflight.adapter.required || preflight.adapter.ok}
                detail={
                  !preflight.adapter.required
                    ? 'not required for this pipeline'
                    : preflight.adapter.ok
                      ? 'clara-lab adapter is live'
                      : 'required for this pipeline'
                }
                hint={
                  preflight.adapter.required
                    ? preflight.adapter.capabilities?.join(', ')
                    : undefined
                }
                action={
                  preflight.adapter.required && !preflight.adapter.ok ? (
                    <button type="button" className="button small" onClick={onEnableAdapter}>
                      Enable lab adapter
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="muted setup-hint">
              Choose the two paths, then press <strong>Check setup</strong>. You should see host
              files readable, the orchestrator workspace visible, and the adapter state.
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function PreflightRow({
  label,
  ok,
  detail,
  hint,
  action,
}: {
  label: string
  ok: boolean
  detail: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="preflight-row">
      <Badge tone={ok ? 'ok' : 'warn'}>{ok ? 'OK' : 'Needs attention'}</Badge>
      <div className="preflight-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
        {hint ? <span className="muted">{hint}</span> : null}
      </div>
      {action ? <div className="preflight-action">{action}</div> : null}
    </div>
  )
}
