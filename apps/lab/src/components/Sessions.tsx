import { useCallback, useEffect, useMemo, useState } from 'react'
import { getOpenCodeSessions } from '../api'
import type { OpenCodeSessionRow, OpenCodeSessionsResult } from '../types'
import type { LabStream } from '../useLab'
import { ago, dateTime } from '../lib/format'
import { Badge } from './Badge'
import { Icon } from './Icon'

export function Sessions({
  stream,
  active,
  onOpenSettings,
}: {
  stream: LabStream
  active: boolean
  onOpenSettings: () => void
}) {
  const [result, setResult] = useState<OpenCodeSessionsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const summary = stream.snapshot?.opencode

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await getOpenCodeSessions())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4_000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  const sessions = useMemo(() => {
    const rows = result?.sessions ?? []
    const text = filter.trim().toLowerCase()
    if (!text) return rows
    return rows.filter((session) =>
      [session.title, session.agent, session.directory, session.id, session.model]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(text)
    )
  }, [result, filter])

  const running = sessions.filter((session) => session.running).length
  const connected = result?.connected ?? summary?.connected ?? false
  const reachable = result?.reachable ?? summary?.reachable ?? false

  return (
    <div className="view sessions-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">OpenCode</div>
          <h1>Sessions</h1>
          <p className="muted">
            Live sessions observed by the lab. Use this to find runaway or forgotten OpenCode work.
          </p>
        </div>
        <div className="view-head-actions">
          <Badge tone={connected ? 'ok' : reachable ? 'warn' : 'bad'}>
            {connected ? 'streaming' : reachable ? 'reachable' : 'offline'}
          </Badge>
          <button
            type="button"
            className="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <Icon name="refresh" size={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="banner bad">{error}</div> : null}

      {!connected ? (
        <div className="banner warn">
          <strong>OpenCode is not streaming.</strong>{' '}
          {result?.error ?? summary?.error ?? 'Start OpenCode or check the URL in Settings.'}{' '}
          <button type="button" className="link" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      ) : null}

      <div className="sessions-toolbar">
        <label className="search-box">
          <Icon name="search" size={14} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by title, agent, directory, or session ID"
          />
        </label>
        <span className="muted">
          {sessions.length} shown · {running} running · {result?.sessionCount ?? 0} known
        </span>
      </div>

      <div className="sessions-table">
        <div className="sessions-head">
          <span />
          <span>Session</span>
          <span>Agent</span>
          <span>Directory</span>
          <span>Last seen</span>
          <span>Events</span>
        </div>
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            expanded={expanded === session.id}
            onToggle={() => setExpanded(expanded === session.id ? undefined : session.id)}
          />
        ))}
        {!sessions.length ? (
          <div className="empty">
            {result
              ? 'No OpenCode sessions match this filter.'
              : 'Waiting for the lab server to report sessions.'}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  expanded,
  onToggle,
}: {
  session: OpenCodeSessionRow
  expanded: boolean
  onToggle: () => void
}) {
  const title = session.title?.trim() || '(untitled session)'
  return (
    <div className={`session-record ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="session-row" onClick={onToggle}>
        <span className={`session-state ${session.running ? 'running' : ''}`} />
        <span className="session-title">
          <strong>{title}</strong>
          <code>{session.id}</code>
        </span>
        <span>{session.agent ?? '—'}</span>
        <span className="session-directory" title={session.directory}>
          {session.directory ?? '—'}
        </span>
        <span title={dateTime(session.lastSeenAt)}>
          {ago(session.lastSeenAt)}
          {session.lastSeenSource === 'event' ? <span className="event-mark">event</span> : null}
        </span>
        <span className="muted">{session.eventCount}</span>
      </button>
      {expanded ? (
        <div className="session-detail">
          <dl className="detail-list compact-list">
            <div>
              <dt>Session ID</dt>
              <dd>
                <code>{session.id}</code>
                <CopyValue value={session.id} />
              </dd>
            </div>
            <div>
              <dt>Directory</dt>
              <dd>
                <code>{session.directory ?? '—'}</code>
                {session.directory ? <CopyValue value={session.directory} /> : null}
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{session.model ?? '—'}</dd>
            </div>
            <div>
              <dt>Parent session</dt>
              <dd>{session.parentID ? <code>{session.parentID}</code> : 'root session'}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{dateTime(session.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Last event</dt>
              <dd>
                {session.lastEventType ?? '—'} · {session.eventCount} observed
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function CopyValue({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="button ghost small"
      onClick={() => {
        void navigator.clipboard?.writeText(value).catch(() => {})
      }}
    >
      <Icon name="copy" size={12} />
      Copy
    </button>
  )
}
