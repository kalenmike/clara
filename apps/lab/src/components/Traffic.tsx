import { useMemo, useState } from 'react'
import type { CallRecord } from '../types'
import type { LabStream } from '../useLab'
import { clock, duration, json, short } from '../lib/format'
import { Badge } from './Badge'
import { Icon } from './Icon'
import { CopyButton, JsonView } from './Json'

type Tab = 'calls' | 'events'

export function Traffic({ stream }: { stream: LabStream }) {
  const [tab, setTab] = useState<Tab>('calls')
  const [filter, setFilter] = useState('')
  const [hideHeartbeats, setHideHeartbeats] = useState(true)

  const calls = useMemo(() => {
    const text = filter.toLowerCase()
    return stream.calls.filter((call) => {
      if (hideHeartbeats && call.source === 'heartbeat') return false
      if (!text) return true
      return call.tool.toLowerCase().includes(text) || call.source.toLowerCase().includes(text)
    })
  }, [stream.calls, filter, hideHeartbeats])

  const events = useMemo(() => {
    const text = filter.toLowerCase()
    if (!text) return stream.events
    return stream.events.filter(
      (event) =>
        event.type.toLowerCase().includes(text) ||
        String(event.run_id).includes(text) ||
        JSON.stringify(event.payload).toLowerCase().includes(text)
    )
  }, [stream.events, filter])

  const errorCount = stream.calls.filter((call) => call.isError || call.error).length

  const download = (): void => {
    const rows = [
      ...stream.calls.map((call) => ({ ...call, kind: 'call' })),
      ...stream.events.map((event) => ({ ...event, kind: 'event', at: event.created_at })),
    ].sort((left, right) => left.at.localeCompare(right.at))
    const blob = new Blob([rows.map((row) => JSON.stringify(row)).join('\n')], {
      type: 'application/x-ndjson',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'clara-lab-traffic.jsonl'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="view traffic-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">Transport</div>
          <h1>Traffic</h1>
          <p className="muted">
            Every MCP call and orchestrator event the lab has seen this session.
          </p>
        </div>
        <div className="view-head-actions">
          {errorCount ? <Badge tone="bad">{errorCount} failed</Badge> : null}
          <button type="button" className="button" onClick={download}>
            Download JSONL
          </button>
        </div>
      </header>

      <div className="traffic-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={tab === 'calls' ? 'active' : ''}
            onClick={() => setTab('calls')}
          >
            MCP calls <span>{stream.calls.length}</span>
          </button>
          <button
            type="button"
            className={tab === 'events' ? 'active' : ''}
            onClick={() => setTab('events')}
          >
            Events <span>{stream.events.length}</span>
          </button>
        </div>
        <label className="search-box grow">
          <Icon name="search" size={14} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by tool, source, event type, run, or payload"
          />
        </label>
        {tab === 'calls' ? (
          <label className="check">
            <input
              type="checkbox"
              checked={hideHeartbeats}
              onChange={(event) => setHideHeartbeats(event.target.checked)}
            />
            Hide heartbeats
          </label>
        ) : null}
      </div>

      <div className="panel traffic-panel">
        {tab === 'calls' ? (
          <div className="call-list">
            {calls.length ? (
              calls
                .slice()
                .reverse()
                .map((call) => <CallRow key={call.id} call={call} />)
            ) : (
              <div className="empty">No MCP calls yet.</div>
            )}
          </div>
        ) : null}

        {tab === 'events' ? (
          <div className="event-list">
            {events.length ? (
              events
                .slice()
                .reverse()
                .map((event) => (
                  <details key={event.id} className="event-row">
                    <summary>
                      <span className="event-time">{clock(event.created_at)}</span>
                      <code>{event.type}</code>
                      <Badge tone="idle">run #{event.run_id}</Badge>
                      <span className="muted">{short(event.payload, 180)}</span>
                    </summary>
                    <div className="row-between">
                      <span className="muted">event {event.id}</span>
                      <CopyButton value={event.payload} />
                    </div>
                    <pre className="json">{json(event.payload)}</pre>
                  </details>
                ))
            ) : (
              <div className="empty">No events yet.</div>
            )}
          </div>
        ) : null}
      </div>

      <details className="panel instructions">
        <summary>MCP server instructions</summary>
        <pre className="prompt">{stream.snapshot?.instructions ?? 'No instructions loaded.'}</pre>
      </details>
    </div>
  )
}

function CallRow({ call }: { call: CallRecord }) {
  return (
    <details className={`call-row ${call.isError ? 'call-error' : ''}`}>
      <summary>
        <span className="event-time">{clock(call.at)}</span>
        <Badge
          tone={call.source === 'heartbeat' ? 'idle' : call.source === 'system' ? 'warn' : 'live'}
        >
          {call.source}
        </Badge>
        <code>{call.tool}</code>
        <span className="muted">{duration(call.durationMs)}</span>
        {call.isError ? <Badge tone="bad">error</Badge> : null}
        {!call.isError && call.error ? <Badge tone="bad">failed</Badge> : null}
      </summary>
      <div className="call-body">
        <div>
          <div className="row-between">
            <h4>Arguments</h4>
            <CopyButton value={call.args} />
          </div>
          <JsonView value={call.args} maxHeight={240} />
        </div>
        <div>
          <div className="row-between">
            <h4>{call.error ? 'Error' : 'Result'}</h4>
            <CopyButton value={call.error ?? call.result} />
          </div>
          {call.error ? <div className="banner bad">{call.error}</div> : null}
          <JsonView value={call.result} maxHeight={360} />
        </div>
      </div>
    </details>
  )
}
