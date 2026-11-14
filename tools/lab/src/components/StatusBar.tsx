import type { LabTab } from '../lib/settings'
import type { LabSnapshot, PreflightResult } from '../types'
import { Icon } from './Icon'

export function StatusBar({
  snapshot,
  workspace,
  preflight,
  preflightError,
  onTab,
}: {
  snapshot: LabSnapshot
  workspace: string
  preflight: PreflightResult | null
  preflightError: string | null
  onTab: (tab: LabTab) => void
}) {
  const checks = preflight
    ? [preflight.host.ok, preflight.runtime.ok, !preflight.adapter.required || preflight.adapter.ok]
    : []
  const issues = checks.filter((ok) => !ok).length
  const setupTone = preflightError || issues ? 'bad' : preflight ? 'ok' : 'idle'

  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <button
          type="button"
          className={`status-item tone-${snapshot.connected ? 'ok' : 'bad'}`}
          title={snapshot.lastError ?? 'Open the settings view'}
          onClick={() => onTab('settings')}
        >
          <span className="status-dot" />
          {snapshot.connected ? 'Orchestrator' : 'Orchestrator offline'}
        </button>
        <button
          type="button"
          className={`status-item tone-${setupTone}`}
          title={preflightError ?? 'Open setup'}
          onClick={() => onTab('settings')}
        >
          <Icon name={setupTone === 'ok' ? 'check' : 'alert'} size={12} />
          {preflightError
            ? 'Setup failed'
            : preflight
              ? issues
                ? `Setup · ${issues} issue${issues === 1 ? '' : 's'}`
                : 'Setup ready'
              : 'Setup unchecked'}
        </button>
      </div>
      <div className="statusbar-group statusbar-meta">
        <span className="status-text">{workspace || 'No workspace selected'}</span>
        <span className="status-text">
          {snapshot.calls.length} calls · {snapshot.events.length} events
        </span>
      </div>
    </footer>
  )
}
