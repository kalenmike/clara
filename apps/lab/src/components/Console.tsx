import { useEffect, useMemo, useState } from 'react'
import { callTool } from '../api'
import type { CallRecord } from '../types'
import type { LabStream } from '../useLab'
import { clock, duration, json, short } from '../lib/format'
import { Badge } from './Badge'
import { Icon } from './Icon'
import { CopyButton, JsonView } from './Json'

export function Console({ stream }: { stream: LabStream }) {
  const tools = stream.snapshot?.tools ?? []
  const [tool, setTool] = useState('clara_list')
  const [args, setArgs] = useState('{}')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tools.length) return
    if (!tools.some((entry) => entry.name === tool)) setTool(tools[0].name)
  }, [tools, tool])

  const selected = tools.find((entry) => entry.name === tool)
  const recent = useMemo(
    () =>
      stream.calls
        .filter((call) => call.source === 'ui')
        .slice(-20)
        .reverse(),
    [stream.calls]
  )

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

  const load = (call: CallRecord): void => {
    setTool(call.tool)
    setArgs(json(call.args))
    setResult(call.error ? undefined : call.result)
    setError(call.error ?? null)
  }

  return (
    <div className="view console-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">Probe</div>
          <h1>Tool console</h1>
          <p className="muted">
            Call the orchestrator MCP surface directly. Every request is recorded in Traffic.
          </p>
        </div>
        <div className="view-head-actions">
          <Badge tone={stream.snapshot?.connected ? 'ok' : 'bad'}>{tools.length} tools</Badge>
        </div>
      </header>

      <div className="console-grid">
        <aside className="panel console-tools">
          <div className="panel-head">
            <h3>Tools</h3>
            <span className="muted">{tools.length}</span>
          </div>
          <div className="tool-picker">
            {tools.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={`tool-option ${entry.name === tool ? 'active' : ''}`}
                onClick={() => setTool(entry.name)}
              >
                <code>{entry.name}</code>
                {entry.description ? <span>{short(entry.description, 110)}</span> : null}
              </button>
            ))}
          </div>

          <div className="panel-head">
            <h3>Recent calls</h3>
            <span className="muted">{recent.length}</span>
          </div>
          <div className="recent-calls">
            {recent.map((call) => (
              <button
                key={call.id}
                type="button"
                className={`recent-call ${call.isError ? 'bad' : ''}`}
                onClick={() => load(call)}
              >
                <span className="event-time">{clock(call.at)}</span>
                <code>{call.tool}</code>
                <span className="muted">{duration(call.durationMs)}</span>
              </button>
            ))}
            {!recent.length ? <div className="empty compact">No calls yet.</div> : null}
          </div>
        </aside>

        <section className="panel console-main">
          <div className="console-tool-head">
            <div>
              <h2>
                <code>{tool}</code>
              </h2>
              <p className="muted">{selected?.description ?? 'Select a tool to inspect it.'}</p>
            </div>
            <button
              type="button"
              className="button primary"
              onClick={() => void send()}
              disabled={busy || !tool}
            >
              <Icon name="play" size={14} />
              {busy ? 'Calling…' : 'Call tool'}
            </button>
          </div>

          <label className="field-block grow-block">
            <span>Arguments (JSON object)</span>
            <textarea
              className="console-input"
              rows={8}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              spellCheck={false}
            />
          </label>

          {error ? <div className="banner bad">{error}</div> : null}

          {result !== null && result !== undefined ? (
            <div className="console-result">
              <div className="row-between">
                <h3>Result</h3>
                <CopyButton value={result} />
              </div>
              <JsonView value={result} maxHeight={420} />
            </div>
          ) : (
            <div className="empty compact">Call a tool to see its result here.</div>
          )}

          {selected?.inputSchema ? (
            <details className="context">
              <summary>Input schema</summary>
              <JsonView value={selected.inputSchema} maxHeight={320} />
            </details>
          ) : null}
        </section>
      </div>
    </div>
  )
}
