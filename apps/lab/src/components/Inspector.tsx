import { useMemo, useState } from 'react'
import { computeBudget } from '@clara/policy'
import type { CompiledNode } from '../types'
import { JsonView, CopyButton } from './Json'
import { Badge, Field } from './Badge'
import { SourceView } from './SourceView'

const TABS = ['prompt', 'policy', 'limits', 'routes', 'source', 'raw'] as const
type Tab = (typeof TABS)[number]

export function Inspector({ node }: { node?: CompiledNode }) {
  const [tab, setTab] = useState<Tab>('prompt')
  const budget = useMemo(() => (node ? computeBudget(node.limits, 1) : undefined), [node])

  if (!node) {
    return <div className="empty">Select a step to inspect it.</div>
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <div className="inspector-title">
            <Badge tone={node.kind === 'task' ? 'live' : node.kind === 'router' ? 'warn' : 'ok'}>
              {node.kind}
            </Badge>
            <h3>{node.title}</h3>
          </div>
          <div className="muted">
            {node.path}
            {node.packageId ? ` · ${node.packageId}` : ''}
          </div>
        </div>
        <div className="chips">
          {node.declared?.length
            ? node.declared.map((field) => (
                <span key={field} className="chip">
                  {field}
                </span>
              ))
            : null}
        </div>
      </div>

      <div className="tabs small-tabs">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={`tab ${tab === name ? 'active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'prompt' ? (
        <div className="inspector-body">
          <div className="row-between">
            <span className="muted">
              prompt source: {node.promptSource ?? 'inherited'} · model: {node.model ?? 'default'}
            </span>
            <CopyButton value={node.prompt ?? ''} label="Copy prompt" />
          </div>
          <pre className="prompt">{node.prompt ?? '(no prompt)'}</pre>
        </div>
      ) : null}

      {tab === 'policy' ? (
        <div className="inspector-body">
          {node.requires ? (
            <Field
              label="Requires"
              value={`${node.requires.adapter ?? 'any adapter'} · ${
                node.requires.capabilities?.join(', ') ?? 'default capabilities'
              }`}
            />
          ) : null}
          <Field label="Enforcement" value={node.enforcement ?? 'observed'} />
          <h4>Effective policy</h4>
          <JsonView value={node.policy} empty="No policy is declared for this step." />
        </div>
      ) : null}

      {tab === 'limits' ? (
        <div className="inspector-body">
          <div className="grid two">
            <Field label="Turns" value={budget?.turns ?? '—'} />
            <Field label="Tokens" value={budget?.tokens ?? '—'} />
            <Field label="Tool calls" value={budget?.maxToolCalls ?? '—'} />
            <Field label="Wall clock" value={`${budget?.wallClockSeconds ?? '—'}s`} />
            <Field label="Max violations" value={budget?.maxViolations ?? '—'} />
            <Field
              label="Retries"
              value={
                node.retries?.auto_attempts !== undefined ? node.retries.auto_attempts : 'default'
              }
            />
          </div>
          <h4>Declared limits</h4>
          <JsonView value={node.limits} empty="No limits are declared; budget defaults apply." />
        </div>
      ) : null}

      {tab === 'routes' ? (
        <div className="inspector-body">
          {node.routes?.length ? (
            <div className="route-list">
              {node.routes.map((route) => (
                <div key={route.when} className="route-item">
                  <div className="route-item-head">
                    <code>{route.when}</code>
                    <span className="muted">→ {route.run}</span>
                  </div>
                  <div>{route.criteria ?? route.description ?? 'No criteria.'}</div>
                  {route.target ? <div className="muted">target: {route.target.path}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">This node has no routes.</div>
          )}
        </div>
      ) : null}

      {tab === 'source' ? (
        <div className="inspector-body">
          <SourceView path={node.source} />
        </div>
      ) : null}

      {tab === 'raw' ? (
        <div className="inspector-body">
          <CopyButton value={node} label="Copy JSON" />
          <JsonView value={node} />
        </div>
      ) : null}
    </div>
  )
}
