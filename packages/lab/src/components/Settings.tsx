import type { ReactNode } from 'react'
import { Badge, Empty } from './Badge'
import { Input } from '@clara/ui/components/input'
import { Notice } from '@clara/ui/patterns/notice'
import { Button } from '@clara/ui/components/button'
import type { LabSnapshot, PreflightResult } from '../types'
import { friendlyError } from '../lib/errors'
import { Icon } from './Icon'

export function SettingsView({
  snapshot,
  hostWorkspace,
  onHostWorkspace,
  browsing,
  onBrowse,
  preflight,
  loading,
  error,
  onCheck,
  onReconnect,
  onEnableAdapter,
  onRemoveAdapter,
}: {
  snapshot: LabSnapshot
  hostWorkspace: string
  onHostWorkspace: (value: string) => void
  browsing: boolean
  onBrowse: () => void
  preflight: PreflightResult | null
  loading: boolean
  error: string | null
  onCheck: () => void
  onReconnect: () => void
  onEnableAdapter: () => void
  onRemoveAdapter: (id: string) => void
}) {
  const runtime = snapshot.engineWorkspace
  const friendly = error ? friendlyError(error, 'runtime') : null
  const ok = Boolean(
    preflight &&
    preflight.host.ok &&
    preflight.runtime.ok &&
    (!preflight.adapter.required || preflight.adapter.ok)
  )
  const issueCount = preflight
    ? [
        preflight.host.ok,
        preflight.runtime.ok,
        !preflight.adapter.required || preflight.adapter.ok,
      ].filter((value) => !value).length
    : 0
  return (
    <div className="view settings-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">Workspace</div>
          <h1>Settings</h1>
          <p className="muted">
            The lab compiles your local files and probes the running engine. Setup lives here; every
            other view only surfaces problems when they matter.
          </p>
        </div>
        <div className="view-head-actions">
          <Badge tone={ok ? 'ok' : preflight ? 'warn' : 'idle'}>
            <Icon name={ok ? 'check' : 'alert'} size={14} />
            {preflight
              ? ok
                ? 'Setup ready'
                : `${issueCount} setup issue${issueCount === 1 ? '' : 's'}`
              : 'Setup unchecked'}
          </Badge>
          <Button type="button" onClick={onCheck} disabled={loading} variant="outline">
            <Icon name="refresh" size={14} />
            {loading ? 'Checking…' : 'Run setup check'}
          </Button>
        </div>
      </header>

      {friendly ? (
        <Notice tone="danger" title={`${friendly.title}.`}>
          {friendly.detail}
          {friendly.hint ? <div className="mt-1 text-xs">{friendly.hint}</div> : null}
        </Notice>
      ) : null}

      <div className="settings-grid">
        <section className="settings-section">
          <div className="section-head">
            <div>
              <h2>Local workspace</h2>
              <p className="muted">The path the lab compiles, watches, and reads source from.</p>
            </div>
            <Badge tone={preflight?.host.ok ? 'ok' : preflight ? 'bad' : 'idle'}>
              {preflight?.host.ok ? 'readable' : preflight ? 'needs attention' : 'unchecked'}
            </Badge>
          </div>
          <label className="field-block">
            <span>Files on this machine</span>
            <div className="path-row">
              <Input
                value={hostWorkspace}
                onChange={(event) => onHostWorkspace(event.target.value)}
                placeholder="/home/jet/Projects/clara"
              />
              <Button type="button" onClick={onBrowse} disabled={browsing} variant="outline">
                <Icon name="folder" size={14} />
                {browsing ? 'Browsing…' : 'Browse…'}
              </Button>
            </div>
          </label>
          <p className="muted section-note">
            Source watching and the compiled tree follow this path. The engine may use a different
            mount; the service workspace is shown below.
          </p>
        </section>

        <section className="settings-section">
          <div className="section-head">
            <div>
              <h2>Engine</h2>
              <p className="muted">MCP, events, and the workspace runs actually use.</p>
            </div>
            <Badge tone={snapshot.connected ? 'ok' : 'bad'}>
              {snapshot.connected ? 'connected' : 'offline'}
            </Badge>
          </div>
          <dl className="detail-list">
            <div>
              <dt>URL</dt>
              <dd>
                <code>{snapshot.engine || '—'}</code>
              </dd>
            </div>
            <div>
              <dt>Runtime workspace</dt>
              <dd>
                <code>{runtime || 'Waiting for the engine…'}</code>
              </dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{snapshot.tokenPresent ? 'present on the lab server' : 'not found'}</dd>
            </div>
          </dl>
          <div className="inline-actions">
            <Button type="button" onClick={onReconnect} variant="outline">
              <Icon name="refresh" size={14} />
              Reconnect
            </Button>
            {!snapshot.tokenPresent ? (
              <span className="muted">
                Start the service or set <code>CLARA_ENGINE_TOKEN</code>.
              </span>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-head">
            <div>
              <h2>Strict adapter</h2>
              <p className="muted">
                Strict pipelines need a live <code>clara-lab</code> adapter for this workspace.
              </p>
            </div>
            <Badge
              tone={
                snapshot.adapters.length
                  ? 'ok'
                  : preflight?.adapter.required && !preflight.adapter.ok
                    ? 'warn'
                    : 'idle'
              }
            >
              {snapshot.adapters.length ? `${snapshot.adapters.length} live` : 'not registered'}
            </Badge>
          </div>
          <div className="adapter-list">
            {snapshot.adapters.map((adapter) => (
              <div key={adapter.id} className="adapter-row">
                <div>
                  <strong>{adapter.harness}</strong>
                  <div className="muted">
                    {adapter.workspace} · heartbeat {adapter.heartbeat_at}
                  </div>
                  <code>{adapter.capabilities}</code>
                </div>
                <Button
                  type="button"
                  onClick={() => onRemoveAdapter(adapter.id)}
                  variant="ghost"
                  size="xs"
                >
                  Remove
                </Button>
              </div>
            ))}
            {!snapshot.adapters.length ? (
              <Empty>
                No adapter is registered. Starting a strict run registers one automatically; you can
                also do it here.
              </Empty>
            ) : null}
          </div>
          <div className="inline-actions">
            <Button type="button" onClick={onEnableAdapter} variant="outline">
              Register lab adapter
            </Button>
            <span className="muted">For orchestration testing, not real enforcement.</span>
          </div>
        </section>

        <section className="settings-section settings-check">
          <div className="section-head">
            <div>
              <h2>Setup check</h2>
              <p className="muted">Host compile, engine catalog, and strict adapter.</p>
            </div>
            {preflight ? (
              <Badge tone={ok ? 'ok' : 'warn'}>{ok ? 'all clear' : `${issueCount} blocking`}</Badge>
            ) : null}
          </div>
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
                label="Engine workspace"
                ok={preflight.runtime.ok}
                detail={
                  preflight.runtime.ok
                    ? `${preflight.runtime.packages ?? 0} packages visible`
                    : friendlyError(
                        preflight.runtime.error ?? 'The engine check failed.',
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
              />
            </div>
          ) : (
            <Empty>
              Run the setup check after choosing the local workspace. Results are also mirrored into
              the status bar.
            </Empty>
          )}
        </section>
      </div>
    </div>
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
