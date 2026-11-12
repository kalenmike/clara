import { Eye, EyeOff, Folder, LogOut, RefreshCw } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import { formatRelative, formatTimestamp } from '../../lib/format.ts'
import { PEEK_MASK } from '../../lib/peek.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { Badge } from '../primitives.tsx'

export function TitleBar({
  data,
  error,
  updatedAt,
  now,
  refreshing,
  onRefresh,
  onLogout,
}: {
  data?: PanelSnapshot
  error?: string
  updatedAt?: number
  now: number
  refreshing: boolean
  onRefresh: () => void
  onLogout: () => void
}) {
  const { masked, toggle } = usePeek()
  const tone = error && data ? 'warning' : data ? 'success' : error ? 'danger' : 'neutral'
  const connection = error && data ? 'Stale' : data ? 'Connected' : error ? 'Offline' : 'Connecting'
  const configPath = data?.agent.configPath
  const updatedIso = updatedAt ? new Date(updatedAt).toISOString() : undefined

  return (
    <header className="panel-titlebar">
      <div className="panel-titlebar-brand">
        <span className="panel-titlebar-mark" aria-hidden="true">
          C
        </span>
        <strong>Clara hub panel</strong>
        <span className="panel-titlebar-tag">hub</span>
      </div>

      <div className="panel-titlebar-path" title={configPath}>
        <Folder className="size-3.5" aria-hidden="true" />
        <code>{configPath ? (masked ? PEEK_MASK : configPath) : 'Waiting for the hub…'}</code>
      </div>

      <div className="panel-titlebar-actions">
        <Badge tone={tone}>{connection}</Badge>
        {updatedIso ? (
          <span className="panel-titlebar-updated" title={formatTimestamp(updatedIso)}>
            Updated {formatRelative(updatedIso, now)}
          </span>
        ) : null}
        {data ? <span className="panel-titlebar-meta">v{data.agent.version}</span> : null}
        <button
          type="button"
          role="switch"
          aria-checked={masked}
          aria-label="Hide sensitive data"
          title={masked ? 'Reveal sensitive data' : 'Hide sensitive data'}
          onClick={toggle}
          className="panel-icon-button"
        >
          {masked ? (
            <Eye className="size-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh the hub snapshot"
          className="panel-button"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="panel-button-label">Refresh</span>
        </button>
        <button type="button" onClick={onLogout} className="panel-button">
          <LogOut className="size-3.5" aria-hidden="true" />
          <span className="panel-button-label">Sign out</span>
        </button>
      </div>
    </header>
  )
}
