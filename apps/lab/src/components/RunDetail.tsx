import type { OrcEvent, StepRow } from '../types'
import { clock, formatTokens, json, modelLabel, short, statusTone } from '../lib/format'
import { Badge, Field } from './Badge'
import { JsonView } from './Json'

export function RunStepDetail({ step }: { step?: StepRow }) {
  if (!step) return <div className="empty">Select a step in the tree.</div>
  const result = step.result ? safeJson(step.result) : undefined

  return (
    <div className="step-detail">
      <div className="row-between">
        <div className="work-title">
          <Badge tone={statusTone(step.status)}>{step.status}</Badge>
          <strong>{step.name}</strong>
          <span className="muted">{step.path}</span>
        </div>
        <span className="muted">
          attempt {step.attempt}/{step.max_attempts}
        </span>
      </div>

      <div className="grid three">
        <Field label="Type" value={step.type} />
        <Field label="Model" value={modelLabel(step.model, step.provider)} />
        <Field label="Lease owner" value={step.lease_owner ?? '—'} />
        <Field label="Heartbeat" value={step.heartbeat_at ? clock(step.heartbeat_at) : '—'} />
        <Field
          label="Lease expires"
          value={step.lease_expires_at ? clock(step.lease_expires_at) : '—'}
        />
        <Field
          label="Usage"
          value={`${step.turns} turns · ${formatTokens(step.tokens)} tokens · ${step.tool_calls} tools · ${step.violations} violations`}
        />
      </div>

      {step.error ? <div className="banner bad">{step.error}</div> : null}

      <h4>Prompt</h4>
      <pre className="prompt">{step.prompt ?? '(no prompt)'}</pre>

      <h4>Result</h4>
      {result !== undefined ? (
        <JsonView value={result} maxHeight={280} />
      ) : (
        <div className="muted">No result recorded.</div>
      )}

      <details className="context">
        <summary>Policy, limits, and raw step</summary>
        <JsonView value={step} />
      </details>
    </div>
  )
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export function RunEvents({ events }: { events: OrcEvent[] }) {
  if (!events.length) return <div className="empty">No events for this run yet.</div>
  return (
    <div className="event-list">
      {events
        .slice(-150)
        .reverse()
        .map((event) => (
          <details key={event.id} className="event-row">
            <summary>
              <span className="event-time">{clock(event.created_at)}</span>
              <code>{event.type}</code>
              <span className="muted">{short(event.payload)}</span>
            </summary>
            <pre className="json">{json(event.payload)}</pre>
          </details>
        ))}
    </div>
  )
}
