import { useMemo, useState } from 'react'
import { callTool } from '../api'
import type { CallRecord } from '../types'
import type { LabStream } from '../useLab'
import { clock, duration, json, short } from '../lib/format'
import { Badge } from './Badge'
import { CopyButton, JsonView } from './Json'

type Tab = 'calls' | 'events' | 'tools'

export function Traffic({ stream }: { stream: LabStream }) {
  const [tab, setTab] = useState<Tab>('calls')
  const [filter, setFilter] = useState('')
  const [tool, setTool] = useState('clara_list')
  const [args, setArgs] = useState('{}')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const calls = useMemo(() => {
    const text = filter.toLowerCase()
    if (!text) return stream.calls
    return stream.calls.filter(
      (call) => call.tool.toLowerCase().includes(text) || call.source.toLowerCase().includes(text)
    )
  }, [stream.calls, filter])

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

  const selectedTool = stream.snapshot?.tools.find((entry) => entry.name === tool)

  const send = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const parsed = JSON.parse(args || '{}') as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Arguments must be a JSON object.')
      }
      const response = await callTool(tool, parsed as Record<string, unknown>)
      setResult(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

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
    <div className="traffic">
      <div className="toolbar">
        <div className="tabs small-tabs">
          <button
            type="button"
            className={`tab ${tab === 'calls' ? 'active' : ''}`}
            onClick={() => setTab('calls')}
          >
            MCP calls ({stream.calls.length})
          </button>
          <button
            type="button"
            className={`tab ${tab === 'events' ? 'active' : ''}`}
            onClick={() => setTab('events')}
          >
            Events ({stream.events.length})
          </button>
          <button
            type="button"
            className={`tab ${tab === 'tools' ? 'active' : ''}`}
            onClick={() => setTab('tools')}
          >
            Raw tool console
          </button>
        </div>
        {tab !== 'tools' ? (
          <input
            className="grow"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by tool, source, event type, run, or payload"
          />
        ) : null}
        <button type="button" className="button" onClick={download}>
          Download JSONL
        </button>
      </div>

      <div className="panel">
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

        {tab === 'tools' ? (
          <div className="tool-console">
            <div className="row">
              <label className="grow">
                Tool
                <select value={tool} onChange={(event) => setTool(event.target.value)}>
                  {(stream.snapshot?.tools ?? []).map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button primary"
                onClick={() => void send()}
                disabled={busy}
              >
                {busy ? 'Calling…' : 'Call tool'}
              </button>
            </div>
            {selectedTool?.description ? (
              <div className="muted">{selectedTool.description}</div>
            ) : null}
            <label className="full">
              Arguments (JSON object)
              <textarea rows={8} value={args} onChange={(event) => setArgs(event.target.value)} />
            </label>
            {error ? <div className="banner bad">{error}</div> : null}
            {result ? (
              <div>
                <div className="row-between">
                  <h4>Result</h4>
                  <CopyButton value={result} />
                </div>
                <JsonView value={result} />
              </div>
            ) : null}
            {selectedTool?.inputSchema ? (
              <details className="context">
                <summary>Input schema</summary>
                <JsonView value={selectedTool.inputSchema} />
              </details>
            ) : null}
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
