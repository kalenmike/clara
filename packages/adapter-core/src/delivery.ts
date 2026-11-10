// Delivery of orchestration results and escalations into the origin session.
//
// The orchestrator owns run state. The adapter owns the bridge back into the
// human-facing OpenCode session: one queued synthetic prompt per new alert, and
// one per finished root run. The planner is pure so the policy is testable
// without a live OpenCode server.

export interface DeliveryRun {
  id: number
  state: string
  prompt?: string | null
  pipeline_ref?: string | null
  parent_run_id?: number | null
  origin_session_id?: string | null
  origin_harness?: string | null
  origin_agent?: string | null
  workspace?: string | null
  error?: string | null
}

export interface DeliveryAlert {
  id: number
  run_id: number
  step_path?: string | null
  kind: string
  title: string
  body: string
}

export interface DeliveryMessage {
  runID: number
  sessionID: string
  alertIDs: number[]
  terminal: boolean
  text: string
  /** Source rows, present when the planner built this message. */
  run?: DeliveryRun
  alerts?: DeliveryAlert[]
}

export interface DeliveryState {
  alerts: Set<number>
  runs: Set<number>
}

/**
 * Reserve a message before it is delivered, so an overlapping or interrupted
 * cycle cannot plan it again. Returns a rollback that removes only the ids this
 * reservation added.
 */
export function reserveDelivery(state: DeliveryState, message: DeliveryMessage): () => void {
  const addedAlerts = message.alertIDs.map(Number).filter((id) => !state.alerts.has(id))
  const addedRun = message.terminal && !state.runs.has(message.runID)
  for (const id of addedAlerts) state.alerts.add(id)
  if (addedRun) state.runs.add(message.runID)
  return () => {
    for (const id of addedAlerts) state.alerts.delete(id)
    if (addedRun) state.runs.delete(message.runID)
  }
}

/**
 * Mark a message the orchestrator assigned to another instance, so this
 * instance stops planning it on every poll.
 */
export function rememberDelivery(state: DeliveryState, message: DeliveryMessage): void {
  for (const id of message.alertIDs) state.alerts.add(Number(id))
  if (message.terminal) state.runs.add(message.runID)
}

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])
const MAX_ALERTS_IN_MESSAGE = 3

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state)
}

export function planDeliveries(input: {
  runs: DeliveryRun[]
  alerts: DeliveryAlert[]
  deliveredAlerts: ReadonlySet<number>
  deliveredRuns: ReadonlySet<number>
  interfaceAgent?: string
}): DeliveryMessage[] {
  const runs = new Map(input.runs.map((run) => [Number(run.id), run]))
  const alertsByRun = new Map<number, DeliveryAlert[]>()

  for (const alert of input.alerts) {
    if (input.deliveredAlerts.has(Number(alert.id))) continue
    const runID = Number(alert.run_id)
    const list = alertsByRun.get(runID) ?? []
    list.push(alert)
    alertsByRun.set(runID, list)
  }

  const messages: DeliveryMessage[] = []
  const seenRuns = new Set<number>()

  // Escalations for runs that are still in flight.
  for (const [runID, alerts] of alertsByRun) {
    const run = runs.get(runID)
    if (!run || !originAllowed(run, input.interfaceAgent)) continue
    if (isTerminalState(String(run.state))) continue
    messages.push({
      runID,
      sessionID: String(run.origin_session_id),
      alertIDs: alerts.map((alert) => Number(alert.id)),
      terminal: false,
      text: alertText(run, alerts),
      run,
      alerts,
    })
    seenRuns.add(runID)
  }

  // One terminal message per finished root run. Child completions roll up into
  // the parent, so they do not need their own prompt.
  for (const run of input.runs) {
    const runID = Number(run.id)
    if (seenRuns.has(runID)) continue
    if (!isTerminalState(String(run.state))) continue
    if (input.deliveredRuns.has(runID)) continue
    if (run.parent_run_id != null) continue
    if (!originAllowed(run, input.interfaceAgent)) continue
    const alerts = alertsByRun.get(runID) ?? []
    messages.push({
      runID,
      sessionID: String(run.origin_session_id),
      alertIDs: alerts.map((alert) => Number(alert.id)),
      terminal: true,
      text: terminalText(run, alerts),
      run,
      alerts,
    })
  }

  return messages
}

function originAllowed(run: DeliveryRun, interfaceAgent: string | undefined): boolean {
  if (!run.origin_session_id) return false
  const expected = interfaceAgent?.trim()
  if (!expected) return true
  const actual = typeof run.origin_agent === 'string' ? run.origin_agent.trim() : ''
  return actual === '' || actual === expected
}

function pipelineLabel(run: DeliveryRun): string {
  return typeof run.pipeline_ref === 'string' && run.pipeline_ref ? run.pipeline_ref : 'pipeline'
}

function alertLines(alerts: DeliveryAlert[]): string {
  if (!alerts.length) return ''
  const shown = alerts.slice(0, MAX_ALERTS_IN_MESSAGE).map((alert) => {
    const step = alert.step_path ? ` at ${alert.step_path}` : ''
    return `- ${alert.kind}${step}: ${alert.title} — ${alert.body}`
  })
  if (alerts.length > MAX_ALERTS_IN_MESSAGE) {
    shown.push(`- and ${alerts.length - MAX_ALERTS_IN_MESSAGE} more open alert(s)`)
  }
  return shown.join('\n')
}

export function messageText(run: DeliveryRun, alerts: DeliveryAlert[], terminal: boolean): string {
  return terminal ? terminalText(run, alerts) : alertText(run, alerts)
}

/**
 * Narrow a planned message to what the orchestrator actually claimed. Return
 * null when another adapter instance owns the run or all of its alerts.
 */
export function applyDeliveryClaim(
  message: DeliveryMessage,
  claim: { terminal: boolean; alerts: number[] }
): DeliveryMessage | null {
  if (message.terminal && !claim.terminal) return null
  if (!message.terminal && !claim.alerts.length) return null
  const alerts = (message.alerts ?? []).filter((alert) => claim.alerts.includes(Number(alert.id)))
  return {
    ...message,
    alertIDs: claim.alerts,
    alerts,
    ...(message.run ? { text: messageText(message.run, alerts, message.terminal) } : {}),
  }
}

function alertText(run: DeliveryRun, alerts: DeliveryAlert[]): string {
  const runID = Number(run.id)
  return [
    `Clara escalation for run ${runID} (${pipelineLabel(run)}).`,
    alertLines(alerts),
    '',
    `Read run ${runID} with clara_status and the open items with clara_inbox. ` +
      'Tell the human what happened and what decision is needed. Do not start a new run.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function terminalText(run: DeliveryRun, alerts: DeliveryAlert[]): string {
  const runID = Number(run.id)
  const label = pipelineLabel(run)
  const state = String(run.state)
  const error = typeof run.error === 'string' && run.error ? `: ${run.error}` : ''
  const heading =
    state === 'completed'
      ? `Clara run ${runID} (${label}) completed.`
      : state === 'cancelled'
        ? `Clara run ${runID} (${label}) was cancelled${error}.`
        : `Clara run ${runID} (${label}) failed${error}.`
  const guidance =
    state === 'completed'
      ? `Read clara_status(${runID}) and report the result to the human. Do not start a new run.`
      : state === 'cancelled'
        ? `Read clara_status(${runID}) and report it to the human. Do not start a new run.`
        : `Read clara_status(${runID}) and clara_inbox, tell the human what happened and what ` +
          'options they have. Do not start a new run.'
  return [heading, alertLines(alerts), '', guidance].filter((line) => line !== '').join('\n')
}
