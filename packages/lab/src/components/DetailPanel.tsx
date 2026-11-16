import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, CircleDashed } from 'lucide-react'
import { Badge, Empty, Field } from './Badge'
import { computeBudget } from '@clara/policy'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@clara/ui/components/tabs'
import { cn } from '@clara/ui/lib/utils'
import type { CompiledNode } from '../types'
import { modelLabel } from '../lib/format'
import { findCompiledNode } from '../lib/tree'
import { JsonView, CopyButton } from './Json'
import { SourceView } from './SourceView'

const TABS = ['prompt', 'inputs', 'policy', 'limits', 'routes', 'source', 'raw'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  prompt: 'Prompt',
  inputs: 'Inputs',
  policy: 'Policy',
  limits: 'Limits',
  routes: 'Routes',
  source: 'Source',
  raw: 'Raw',
}

export function DetailPanel({
  node,
  root,
  collapsed,
  onToggle,
  sourceOverride,
  onClearSource,
  onSelectNode,
}: {
  node?: CompiledNode
  root?: CompiledNode
  collapsed: boolean
  onToggle: () => void
  sourceOverride?: string
  onClearSource: () => void
  onSelectNode: (node: CompiledNode) => void
}) {
  const [tab, setTab] = useState<Tab>('prompt')
  const budget = useMemo(() => (node ? computeBudget(node.limits, 1) : undefined), [node])
  const tone =
    node?.kind === 'agent'
      ? 'live'
      : node?.kind === 'script'
        ? 'ok'
        : node?.kind === 'router' || node?.name.startsWith('wrapper:')
          ? 'warn'
          : 'ok'
  const label = node?.slot ? 'slot' : node?.name.startsWith('wrapper:') ? 'wrapper' : node?.kind

  useEffect(() => {
    if (!sourceOverride) return
    setTab('source')
  }, [sourceOverride])

  return (
    <section className="detail-panel flex min-h-0 shrink-0 flex-col border-t bg-card">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand detail panel' : 'Collapse detail panel'}
          title={collapsed ? 'Expand details' : 'Collapse details'}
        >
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Detail
        </span>
        {node ? (
          <>
            <Badge tone={tone}>{label}</Badge>
            <span className="min-w-0 truncate text-xs font-semibold">{node.title}</span>
            {node.path && node.path !== node.packageId ? (
              <span className="hidden min-w-0 truncate font-mono text-[10px] text-muted-foreground md:inline">
                {node.path}
              </span>
            ) : null}
            {node.packageId ? (
              <span className="hidden rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground lg:inline">
                {node.packageId}
              </span>
            ) : null}
          </>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            Select a graph node to inspect it
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {node?.declared?.length ? (
            <div className="hidden flex-wrap gap-1 lg:flex">
              {node.declared.map((field) => (
                <span
                  key={field}
                  className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                >
                  {field}
                </span>
              ))}
            </div>
          ) : null}
          {node ? <CopyButton value={node} label="Copy JSON" /> : null}
        </div>
      </header>

      {!collapsed ? (
        <div className="min-h-0 border-t">
          {node?.slot ? (
            <div className="flex items-start gap-2 border-b bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <CircleDashed
                className="mt-0.5 size-3.5 shrink-0 text-indigo-500"
                aria-hidden="true"
              />
              <span>
                This is a runtime slot. The routed pipeline&apos;s steps run here when the wrapper
                is applied. Select a pipeline target to inspect its steps.
              </span>
            </div>
          ) : null}
          {node ? (
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as Tab)}
              className="h-full gap-0"
            >
              <TabsList variant="line" className="w-full justify-start px-2">
                {TABS.map((name) => (
                  <TabsTrigger key={name} value={name}>
                    {TAB_LABELS[name]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="h-[min(30vh,300px)] overflow-auto p-3">
                <TabsContent value="prompt" className="m-0">
                  {node.kind === 'script' ? (
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
                  )}
                </TabsContent>

                <TabsContent value="inputs" className="m-0">
                  <DetailInputs node={node} root={root} onSelectNode={onSelectNode} />
                </TabsContent>

                <TabsContent value="policy" className="m-0">
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
                </TabsContent>

                <TabsContent value="limits" className="m-0">
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
                          node.retries?.auto_attempts !== undefined
                            ? node.retries.auto_attempts
                            : 'default'
                        }
                      />
                    </div>
                    <h4>Declared limits</h4>
                    <JsonView
                      value={node.limits}
                      empty="No limits are declared; budget defaults apply."
                    />
                  </div>
                </TabsContent>

                <TabsContent value="routes" className="m-0">
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
                            {route.target ? (
                              <div className="muted">target: {route.target.path}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty>This node has no routes.</Empty>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="source" className="m-0">
                  <div className="inspector-body">
                    {sourceOverride ? (
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Diagnostic source</span>
                        <button
                          type="button"
                          className="text-xs text-primary underline-offset-4 hover:underline"
                          onClick={onClearSource}
                        >
                          Show node source
                        </button>
                      </div>
                    ) : null}
                    <SourceView path={sourceOverride ?? node.source} />
                  </div>
                </TabsContent>

                <TabsContent value="raw" className="m-0">
                  <div className="inspector-body">
                    <CopyButton value={node} label="Copy JSON" />
                    <JsonView value={node} />
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            <div className="p-3">
              <Empty>Select a node in the graph to inspect its prompt, inputs, and policy.</Empty>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function DetailInputs({
  node,
  root,
  onSelectNode,
}: {
  node: CompiledNode
  root?: CompiledNode
  onSelectNode: (node: CompiledNode) => void
}) {
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
              <div
                className={cn('input-item', target && 'cursor-pointer')}
                key={`${label}:${path}`}
              >
                <div className="row-between">
                  <strong>{label}</strong>
                  {target ? (
                    <button
                      type="button"
                      className="muted text-xs underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => onSelectNode(target)}
                    >
                      {target.kind} · {target.title}
                    </button>
                  ) : (
                    <span className="muted">unresolved step</span>
                  )}
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
