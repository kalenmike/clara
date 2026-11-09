import { useState } from 'react'
import { callTool, violation } from '../api'
import type { WorkRecord } from '../types'
import { friendlyError } from '../lib/errors'
import { modelLabel, parseMaybeJson, short } from '../lib/format'
import { Badge } from './Badge'
import { InputList } from './Inputs'
import { JsonView } from './Json'

function numeric(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function WorkOrderCard({
  record,
  autoRun,
  primary,
  onChanged,
  onNotice,
}: {
  record: WorkRecord
  autoRun: boolean
  primary: boolean
  onChanged: (runID: number) => void
  onNotice: (message: string) => void
}) {
  const order = record.order
  const isRouter = order.kind === 'router' && Boolean(order.routes?.length)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [turns, setTurns] = useState('')
  const [tokens, setTokens] = useState('')
  const [toolCalls, setToolCalls] = useState('')
  const [violations, setViolations] = useState('')
  const [route, setRoute] = useState(order.routes?.[0]?.when ?? '')
  const [spawnCount, setSpawnCount] = useState('2')
  const [spawnPrompt, setSpawnPrompt] = useState(order.prompt)
  const [policyAction, setPolicyAction] = useState('write')
  const [policyTool, setPolicyTool] = useState('edit')
  const [policyResources, setPolicyResources] = useState('src/')
  const [policyCommand, setPolicyCommand] = useState('')
  const [policyNetwork, setPolicyNetwork] = useState('')
  const [decision, setDecision] = useState<unknown>(null)
  const [violationReason, setViolationReason] = useState('manual lab violation')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showUsage, setShowUsage] = useState(false)

  const usage = (): Record<string, number> | undefined => {
    const value: Record<string, number> = {}
    const turnValue = numeric(turns)
    const tokenValue = numeric(tokens)
    const callValue = numeric(toolCalls)
    const violationValue = numeric(violations)
    if (turnValue !== undefined) value.turns = turnValue
    if (tokenValue !== undefined) value.tokens = tokenValue
    if (callValue !== undefined) value.toolCalls = callValue
    if (violationValue !== undefined) value.violations = violationValue
    return Object.keys(value).length ? value : undefined
  }

  const runAction = async (
    tool: string,
    args: Record<string, unknown>,
    success: string
  ): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await callTool(tool, args)
      if (response.isError) {
        setMessage(`The orchestrator rejected the action: ${short(response.value)}`)
        return false
      }
      if (autoRun) {
        await callTool('clara_next', { run_id: order.run_id, limit: 8 }).catch(() => {})
      }
      onChanged(order.run_id)
      onNotice(success)
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  const complete = async (): Promise<void> => {
    const sent = await runAction(
      'clara_complete',
      {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
        result: parseMaybeJson(result) ?? '',
        ...(usage() ? { usage: usage() } : {}),
      },
      autoRun ? 'Step complete. Continuing to the next step.' : 'Step complete.'
    )
    if (sent) setResult('')
  }

  const chooseRoute = async (): Promise<void> => {
    await runAction(
      'clara_route',
      {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
        route,
      },
      autoRun ? `Routed to ${route}. Continuing.` : `Routed to ${route}.`
    )
  }

  const fail = async (): Promise<void> => {
    await runAction(
      'clara_fail',
      {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
        error: error.trim() || 'lab failure',
        ...(usage() ? { usage: usage() } : {}),
      },
      'Failure recorded.'
    )
  }

  const spawn = async (): Promise<void> => {
    const count = Number(spawnCount)
    if (!Number.isInteger(count) || count < 1) {
      setMessage('Spawn count must be a whole number of at least 1.')
      return
    }
    await runAction(
      'clara_spawn',
      {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
        count,
        prompt: spawnPrompt.trim() || order.prompt,
      },
      `Spawned ${count} worker(s).`
    )
  }

  const check = async (): Promise<void> => {
    setBusy(true)
    setDecision(null)
    try {
      const response = await callTool('clara_check', {
        run_id: order.run_id,
        step_path: order.step_path,
        action: policyAction,
        ...(policyTool ? { tool: policyTool } : {}),
        ...(policyResources.trim()
          ? {
              resources: policyResources
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
        ...(policyCommand ? { command: policyCommand } : {}),
        ...(policyNetwork ? { network: policyNetwork } : {}),
      })
      setDecision(response.value)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const raiseViolation = async (): Promise<void> => {
    setBusy(true)
    try {
      await violation(order.run_id, order.step_path, violationReason)
      onChanged(order.run_id)
      onNotice('Violation recorded.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const exceedBudget = async (): Promise<void> => {
    await runAction(
      'clara_complete',
      {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
        result: parseMaybeJson(result) ?? 'budget test',
        usage: { turns: 999_999, tokens: 999_999_999, toolCalls: 999_999, violations: 999 },
      },
      'Completed with a deliberately exceeded budget.'
    )
  }

  const heartbeat = async (): Promise<void> => {
    try {
      await callTool('clara_heartbeat', {
        run_id: order.run_id,
        step_path: order.step_path,
        work_token: order.work_token,
      })
      onChanged(order.run_id)
      onNotice('Lease renewed.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const friendly = message ? friendlyError(message, 'start') : null

  return (
    <article className={`work-card ${primary ? 'work-card-primary' : ''}`}>
      <header className="work-head">
        <div>
          <div className="work-title">
            <Badge tone="live">{order.kind}</Badge>
            <strong>{order.name}</strong>
            <span className="muted">run #{order.run_id}</span>
            {primary ? <Badge tone="ok">current</Badge> : null}
          </div>
          <div className="muted">
            {order.step_path} · attempt {order.attempt}/{order.max_attempts} · {order.enforcement}
            {order.model ? ` · ${modelLabel(order.model, order.provider)}` : ''}
          </div>
        </div>
        <div className="chips">
          <span className="chip">{record.heartbeats} beats</span>
          {record.lastHeartbeatAt ? (
            <span className="chip">last {record.lastHeartbeatAt.slice(11, 19)}</span>
          ) : null}
          {order.background ? <span className="chip">background</span> : null}
        </div>
      </header>

      <div className="work-grid">
        <div>
          <div className="row-between">
            <h4>{isRouter ? 'Choose a route' : 'Task'}</h4>
            <span className="muted">
              budget {String(order.budget.turns ?? '?')} turns ·{' '}
              {String(order.budget.tokens ?? '?')} tokens
            </span>
          </div>
          <pre className="prompt">{order.prompt}</pre>
          <details className="panel step-panel">
            <summary>
              <span>Inputs and artifacts</span>
              <span className="muted">
                {order.context.inputs.length ? `${order.context.inputs.length} declared` : 'none'}
              </span>
            </summary>
            <div className="step-panel-body">
              <InputList
                inputs={order.context.inputs}
                artifacts={order.context.artifacts}
                empty="This step declares no inputs."
              />
              <h4>Root request</h4>
              <pre className="prompt small">{order.context.prompt}</pre>
            </div>
          </details>
          {order.policy ? (
            <details className="context">
              <summary>Policy and limits</summary>
              <JsonView value={{ policy: order.policy, limits: order.limits }} />
            </details>
          ) : null}
          <div className="muted work-hint">
            The lab holds this step for you. Keep auto-heartbeat on while you type; the lease is
            renewed every ten seconds.
          </div>
        </div>

        <div>
          {isRouter ? (
            <>
              <h4>Route</h4>
              <div className="route-picker">
                <label>
                  Choose the route the classifier would pick
                  <select value={route} onChange={(event) => setRoute(event.target.value)}>
                    {order.routes?.map((item) => (
                      <option key={item.when} value={item.when}>
                        {item.when} — {item.criteria ?? item.run}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="button primary"
                onClick={() => void chooseRoute()}
                disabled={busy}
              >
                {autoRun ? 'Choose route and continue' : 'Choose route'}
              </button>
            </>
          ) : (
            <>
              <h4>Your result</h4>
              <textarea
                className="result-input"
                value={result}
                onChange={(event) => setResult(event.target.value)}
                placeholder="Type the result the AI would return. Plain text or JSON."
                rows={6}
              />
              <button
                type="button"
                className="button primary"
                onClick={() => void complete()}
                disabled={busy}
              >
                {autoRun ? 'Complete and continue' : 'Complete step'}
              </button>
              <div className="muted work-hint">
                The result is stored as the step output and shown in the Steps tree.
              </div>
            </>
          )}

          {friendly ? (
            <div className="banner bad">
              <strong>{friendly.title}.</strong> {friendly.detail}
              {friendly.hint ? <div className="muted">{friendly.hint}</div> : null}
            </div>
          ) : null}

          <details className="advanced">
            <summary>Usage and advanced actions</summary>

            <button type="button" className="link" onClick={() => setShowUsage((value) => !value)}>
              {showUsage ? 'Hide usage fields' : 'Report usage (optional)'}
            </button>
            {showUsage ? (
              <div className="usage-row">
                <label>
                  turns
                  <input
                    value={turns}
                    onChange={(event) => setTurns(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  tokens
                  <input
                    value={tokens}
                    onChange={(event) => setTokens(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  tools
                  <input
                    value={toolCalls}
                    onChange={(event) => setToolCalls(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  violations
                  <input
                    value={violations}
                    onChange={(event) => setViolations(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
              </div>
            ) : null}

            <h4>Failure</h4>
            <label className="full">
              Failure error
              <input
                value={error}
                onChange={(event) => setError(event.target.value)}
                placeholder="why the step failed"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="button danger"
                onClick={() => void fail()}
                disabled={busy}
              >
                Fail step
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void exceedBudget()}
                disabled={busy}
              >
                Exceed budget and complete
              </button>
            </div>

            <h4>Policy</h4>
            <div className="grid two">
              <label>
                action
                <input
                  value={policyAction}
                  onChange={(event) => setPolicyAction(event.target.value)}
                />
              </label>
              <label>
                tool
                <input value={policyTool} onChange={(event) => setPolicyTool(event.target.value)} />
              </label>
              <label>
                resources
                <input
                  value={policyResources}
                  onChange={(event) => setPolicyResources(event.target.value)}
                />
              </label>
              <label>
                command
                <input
                  value={policyCommand}
                  onChange={(event) => setPolicyCommand(event.target.value)}
                />
              </label>
              <label>
                network
                <input
                  value={policyNetwork}
                  onChange={(event) => setPolicyNetwork(event.target.value)}
                />
              </label>
            </div>
            <div className="actions">
              <button type="button" className="button" onClick={() => void check()} disabled={busy}>
                Check policy
              </button>
              <button type="button" className="button" onClick={() => void heartbeat()}>
                Renew lease
              </button>
            </div>
            {decision ? <JsonView value={decision} /> : null}

            <h4>Violation</h4>
            <label className="full">
              Violation reason
              <input
                value={violationReason}
                onChange={(event) => setViolationReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button"
              onClick={() => void raiseViolation()}
              disabled={busy}
            >
              Record violation
            </button>

            <h4>Spawn workers</h4>
            <div className="row">
              <label>
                Count
                <input
                  value={spawnCount}
                  onChange={(event) => setSpawnCount(event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="grow">
                Prompt
                <input
                  value={spawnPrompt}
                  onChange={(event) => setSpawnPrompt(event.target.value)}
                />
              </label>
              <button type="button" className="button" onClick={() => void spawn()} disabled={busy}>
                Spawn
              </button>
            </div>
          </details>
        </div>
      </div>
    </article>
  )
}
