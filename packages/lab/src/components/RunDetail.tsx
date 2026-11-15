import { useState } from 'react'
import type { OrcEvent, StepDetail } from '../types'
import {
  clock,
  formatTokens,
  json,
  modelLabel,
  parseMaybeJson,
  short,
  statusTone,
} from '../lib/format'
import { Badge, Field } from './Badge'
import { InputList } from './Inputs'
import { CopyButton, JsonView } from './Json'
import { Markdown } from './Markdown'

type PromptFormat = 'md' | 'raw'
type ResultFormat = 'md' | 'json' | 'raw'

function FormatToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <span
      className="segmented summary-toggle"
      role="group"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

function parseResult(value: string): { value: unknown; valid: boolean } {
  try {
    return { value: JSON.parse(value) as unknown, valid: true }
  } catch {
    return { value, valid: false }
  }
}

export function RunStepDetail({ step }: { step?: StepDetail }) {
  const [promptFormat, setPromptFormat] = useState<PromptFormat>('md')
  const [resultFormat, setResultFormat] = useState<ResultFormat>('md')

  if (!step) return <div className="empty">Select a step in the tree.</div>

  const prompt = step.prompt ?? ''
  const resultText = step.result ?? ''
  const parsedResult = resultText ? parseResult(resultText) : undefined

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

      <details className="panel step-panel">
        <summary>
          <span>Prompt</span>
          <FormatToggle
            label="Prompt format"
            value={promptFormat}
            options={[
              { value: 'md', label: 'MD' },
              { value: 'raw', label: 'RAW' },
            ]}
            onChange={setPromptFormat}
          />
        </summary>
        <div className="step-panel-body">
          {prompt ? (
            promptFormat === 'md' ? (
              <Markdown breaks>{prompt}</Markdown>
            ) : (
              <pre className="prompt">{prompt}</pre>
            )
          ) : (
            <div className="muted">(no prompt)</div>
          )}
        </div>
      </details>

      <details className="panel step-panel">
        <summary>
          <span>Result</span>
          <FormatToggle
            label="Result format"
            value={resultFormat}
            options={[
              { value: 'md', label: 'MD' },
              { value: 'json', label: 'JSON' },
              { value: 'raw', label: 'RAW' },
            ]}
            onChange={setResultFormat}
          />
        </summary>
        <div className="step-panel-body">
          {resultText ? (
            resultFormat === 'md' ? (
              <Markdown breaks>{resultText}</Markdown>
            ) : resultFormat === 'json' ? (
              parsedResult?.valid ? (
                <JsonView value={parsedResult.value} maxHeight={280} />
              ) : (
                <>
                  <div className="muted">Result is not valid JSON; showing raw text.</div>
                  <pre className="prompt">{resultText}</pre>
                </>
              )
            ) : (
              <pre className="prompt">{resultText}</pre>
            )
          ) : (
            <div className="muted">No result recorded.</div>
          )}
        </div>
      </details>

      <details className="panel step-panel">
        <summary>
          <span>Inputs</span>
          <span className="muted">
            {step.inputs.length ? `${step.inputs.length} declared` : 'none'}
          </span>
        </summary>
        <div className="step-panel-body">
          <InputList
            inputs={step.inputs}
            artifacts={step.artifacts}
            empty="No inputs are declared for this step."
          />
        </div>
      </details>

      <details className="panel step-panel">
        <summary>Policy, limits, and raw step</summary>
        <div className="step-panel-body">
          <h4>Policy</h4>
          <JsonView value={parseMaybeJson(step.policy ?? '')} empty="No policy recorded." />
          <h4>Limits</h4>
          <JsonView value={parseMaybeJson(step.limits ?? '')} empty="No limits recorded." />
          <div className="row-between">
            <h4>Raw step</h4>
            <CopyButton value={step} label="Copy JSON" />
          </div>
          <JsonView value={step} />
        </div>
      </details>
    </div>
  )
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
