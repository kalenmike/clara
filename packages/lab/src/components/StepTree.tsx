import { Badge, Empty } from './Badge'
import type { StepSummary } from '../types'
import { ago, formatTokens, statusTone } from '../lib/format'

export function RunTree({
  steps,
  selected,
  onSelect,
}: {
  steps: StepSummary[]
  selected?: string
  onSelect: (step: StepSummary) => void
}) {
  if (!steps.length) return <Empty>No steps yet.</Empty>
  return (
    <div className="run-tree">
      {steps.map((step) => {
        const depth = step.path.split('/').length - 1
        return (
          <button
            key={step.path}
            type="button"
            className={`run-row ${selected === step.path ? 'selected' : ''}`}
            style={{ paddingLeft: depth * 16 + 4 }}
            onClick={() => onSelect(step)}
          >
            <Badge tone={statusTone(step.status)}>{step.status}</Badge>
            <span className="run-name">{step.name}</span>
            <span className="run-type">{step.type}</span>
            <span className="run-attempt">
              {step.attempt}/{step.max_attempts}
            </span>
            {step.status === 'running' ? (
              <span className="muted">beat {ago(step.heartbeat_at)}</span>
            ) : null}
            {step.turns || step.tokens || step.tool_calls || step.violations ? (
              <span className="muted">
                {step.turns}t · {formatTokens(step.tokens)} tokens · {step.tool_calls} calls
                {step.violations ? ` · ${step.violations} violations` : ''}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
