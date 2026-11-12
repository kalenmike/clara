import { PANEL_API_VERSION, type PanelSnapshot } from '@clara/shared-types'
import { formatRelative, formatTimestamp } from '../../lib/format.ts'
import { buildHealth, type HealthTone } from '../../lib/health.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import type { PanelTab } from '../../lib/tabs.ts'

const TONE_CLASS: Record<HealthTone, string> = {
  ok: 'tone-ok',
  warn: 'tone-warn',
  bad: 'tone-bad',
  idle: 'tone-idle',
}

export function StatusBar({
  data,
  now,
  onSelect,
}: {
  data?: PanelSnapshot
  now: number
  onSelect: (tab: PanelTab) => void
}) {
  const { redact } = usePeek()

  if (!data) {
    return (
      <footer className="panel-statusbar">
        <div className="panel-status-group">
          <span className="panel-status-item">
            <span className="panel-status-dot" aria-hidden="true" />
            Connecting
          </span>
        </div>
        <div className="panel-status-group panel-status-meta">
          <span className="panel-status-text">API v{PANEL_API_VERSION}</span>
        </div>
      </footer>
    )
  }

  const health = buildHealth(data)
  const [harness, local, relay, push, orchestration] = health
  const activeClients = data.clients.filter((client) => client.kind === 'device').length
  const pairing = data.clients.filter((client) => client.kind === 'enroll').length
  const clientsLabel = pairing
    ? `${activeClients} clients · ${pairing} pairing`
    : `${activeClients} client${activeClients === 1 ? '' : 's'}`

  return (
    <footer className="panel-statusbar">
      <div className="panel-status-group">
        <StatusItem
          tone={data.controls.stopped ? 'warn' : 'ok'}
          label={data.controls.stopped ? 'Connections off' : 'Connections on'}
          title={
            data.controls.stopped
              ? 'External connections are off. Open Overview to go online.'
              : 'External connections are on.'
          }
          onClick={() => onSelect('overview')}
        />
        <StatusItem
          tone={harness.tone}
          label={`Harness · ${harness.status}`}
          title={redact(harness.detail)}
          onClick={() => onSelect('harness')}
        />
        <StatusItem
          tone={local.tone}
          label={`Local · ${data.local.connections}`}
          title={redact(local.detail)}
          onClick={() => onSelect('connections')}
        />
        <StatusItem
          tone={relay.tone}
          label={`Relay · ${relay.status}`}
          title={redact(relay.detail)}
          onClick={() => onSelect('connections')}
        />
        <StatusItem
          tone={push.tone}
          label={
            data.push.failing > 0
              ? `Push · ${data.push.failing} failing`
              : `Push · ${data.push.subscriptions}`
          }
          title={redact(push.detail)}
          onClick={() => onSelect('connections')}
        />
        <StatusItem
          tone={orchestration.tone}
          label={`Orchestration · ${orchestration.status}`}
          title={redact(orchestration.detail)}
          onClick={() => onSelect('overview')}
        />
        <StatusItem
          tone="idle"
          label={clientsLabel}
          title="Open the connected clients view"
          onClick={() => onSelect('clients')}
        />
      </div>
      <div className="panel-status-group panel-status-meta">
        <span className="panel-status-text" title={formatTimestamp(data.generatedAt)}>
          generated {formatRelative(data.generatedAt, now)}
        </span>
        <span className="panel-status-text">
          {data.auth.username} · API v{data.apiVersion}
        </span>
      </div>
    </footer>
  )
}

function StatusItem({
  tone,
  label,
  title,
  onClick,
}: {
  tone: HealthTone
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`panel-status-item ${TONE_CLASS[tone]}`}
      title={title}
      onClick={onClick}
    >
      <span className="panel-status-dot" aria-hidden="true" />
      {label}
    </button>
  )
}
