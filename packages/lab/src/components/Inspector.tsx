import { useMemo, useState } from 'react'
import { Empty } from './Badge'
import { computeBudget } from '@clara/policy'
import type { CompiledNode } from '../types'
import { modelLabel } from '../lib/format'
import { findCompiledNode } from '../lib/tree'
import { JsonView, CopyButton } from './Json'
import { Badge, Field } from './Badge'
import { SourceView } from './SourceView'

const TABS = ['prompt', 'inputs', 'policy', 'limits', 'routes', 'source', 'raw'] as const
type Tab = (typeof TABS)[number]

export function Inspector({ node, root }: { node?: CompiledNode; root?: CompiledNode }) {
  const [tab, setTab] = useState<Tab>('prompt')
  const budget = useMemo(() => (node ? computeBudget(node.limits, 1) : undefined), [node])

  if (!node) {
    return <Empty>Select a step to inspect it.</Empty>
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <div className="inspector-title">
            <Badge
              tone={
                node.kind === 'agent'
                  ? 'live'
                  : node.kind === 'script'
                    ? 'ok'
                    : node.kind === 'router'
                      ? 'warn'
                      : 'ok'
              }
            >
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
        node.kind === 'script' ? (
          <div className="inspector-body">
            <div className="row-between">
              <span className="muted">
                script · timeout {node.script?.timeoutSeconds ?? 'default'}s ·{' '}
                {node.script?.resultMode ?? 'auto'} result
              </span>
              <CopyButton value={node.script?.command ?? ''} label="Copy command" />
            </div>
            <pre className="prompt">{node.script?.command ?? '(no command)'}</pre>
          </div>
        ) : (
          <div className="inspector-body">
            <div className="row-between">
              <span className="muted">
                prompt source: {node.promptSource ?? 'inherited'} · model:{' '}
                {modelLabel(node.model, node.provider)}
              </span>
              <CopyButton value={node.prompt ?? ''} label="Copy prompt" />
            </div>
            <pre className="prompt">{node.prompt ?? '(no prompt)'}</pre>
          </div>
        )
      ) : null}

      {tab === 'inputs' ? <InspectorInputs node={node} root={root} /> : null}

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
            <Empty>This node has no routes.</Empty>
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

function InspectorInputs({ node, root }: { node: CompiledNode; root?: CompiledNode }) {
  const inputs = Object.entries(node.inputs ?? {})
  const artifacts = Object.entries(node.artifacts ?? {})
  const request = node.request !== false

  return (
    <div className="inspector-body">
      <Field
        label="Request"
        value={request ? 'Included as background' : 'Omitted (request: false)'}
      />

      <h4>Inputs</h4>
      {inputs.length ? (
        <div className="input-list">
          {inputs.map(([label, path]) => {
            const target = root ? findCompiledNode(root, path) : undefined
            return (
              <div className="input-item" key={`${label}:${path}`}>
                <div className="row-between">
                  <strong>{label}</strong>
                  <span className="muted">
                    {target ? `${target.kind} · ${target.title}` : 'unresolved step'}
                  </span>
                </div>
                <code>{path}</code>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="muted">No inputs are declared.</div>
      )}

      <h4>Artifacts</h4>
      {artifacts.length ? (
        <ul className="input-artifacts">
          {artifacts.map(([label, path]) => (
            <li key={`${label}:${path}`}>
              <strong>{label}</strong> <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">No artifacts are declared.</div>
      )}

      <div className="muted inputs-note">
        Input results appear in Runs after the referenced steps execute.
      </div>
    </div>
  )
}
