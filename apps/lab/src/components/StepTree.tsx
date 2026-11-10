import { useState } from 'react'
import type { CompiledNode, StepSummary } from '../types'
import { ago, formatTokens, modelLabel, statusTone } from '../lib/format'
import { Badge } from './Badge'

function kindTone(kind: string): 'ok' | 'bad' | 'live' | 'idle' | 'warn' {
  if (kind === 'agent') return 'live'
  if (kind === 'script') return 'ok'
  if (kind === 'router') return 'warn'
  if (kind === 'pipeline') return 'ok'
  return 'idle'
}

export function CompiledTree({
  root,
  selected,
  onSelect,
}: {
  root: CompiledNode
  selected?: string
  onSelect: (node: CompiledNode) => void
}) {
  return (
    <div className="tree">
      <CompiledRow node={root} depth={0} selected={selected} onSelect={onSelect} />
    </div>
  )
}

function CompiledRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: CompiledNode
  depth: number
  selected?: string
  onSelect: (node: CompiledNode) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = Boolean(node.children?.length || node.routes?.length)

  return (
    <div>
      <div className={`tree-row ${selected === node.path ? 'selected' : ''}`}>
        <button
          type="button"
          className="tree-toggle"
          onClick={() => setOpen((value) => !value)}
          disabled={!hasChildren}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </button>
        <button
          type="button"
          className="tree-main"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => onSelect(node)}
        >
          <Badge tone={kindTone(node.kind)}>{node.kind}</Badge>
          <span className="tree-name">{node.title}</span>
          {node.model ? (
            <span className="chip">{modelLabel(node.model, node.provider)}</span>
          ) : null}
          {node.enforcement ? (
            <span className={`chip chip-${node.enforcement === 'strict' ? 'warn' : 'idle'}`}>
              {node.enforcement}
            </span>
          ) : null}
          {node.background ? <span className="chip">background</span> : null}
          {node.promptSource === 'fallback' ? <Badge tone="warn">generated prompt</Badge> : null}
          <span className="tree-path">{node.path}</span>
        </button>
      </div>
      {open ? (
        <>
          {node.children?.map((child) => (
            <CompiledRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
          {node.routes?.map((route) => (
            <div key={`${node.path}-${route.when}`}>
              <div className="route-row" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
                <span className="route-when">{route.when}</span>
                <span className="muted">
                  {route.criteria ?? route.description ?? 'no criteria'}
                </span>
              </div>
              {route.target ? (
                <CompiledRow
                  node={route.target}
                  depth={depth + 2}
                  selected={selected}
                  onSelect={onSelect}
                />
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

export function RunTree({
  steps,
  selected,
  onSelect,
}: {
  steps: StepSummary[]
  selected?: string
  onSelect: (step: StepSummary) => void
}) {
  if (!steps.length) return <div className="empty">No steps yet.</div>
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
