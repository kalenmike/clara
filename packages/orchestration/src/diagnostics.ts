import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'

export interface DiagnosticsOptions {
  /** Window in days. Zero or negative analyzes all history. */
  days?: number
  /** Fixed clock for reproducible tests and reports. */
  now?: Date
  /** Database path, included in the report when known. */
  path?: string
}

export interface DiagnosticsWindow {
  days: number
  since: string | null
  until: string
}

export interface RunTotals {
  total: number
  by_state: Record<string, number>
  completed: number
  failed: number
  cancelled: number
  active: number
  failure_rate: number
  avg_duration_seconds: number | null
  last_failure_at: string | null
}

export interface StepTotals {
  total: number
  by_status: Record<string, number>
  failed: number
  retried: number
  exhausted: number
  avg_attempts: number
}

export interface PipelineHealth {
  pipeline: string
  entry: string
  runs: number
  completed: number
  failed: number
  cancelled: number
  active: number
  failure_rate: number
  steps: number
  failed_steps: number
  open_alerts: number
  last_failure_at: string | null
}

export interface StepHealth {
  pipeline: string
  name: string
  path: string
  steps: number
  runs: number
  failures: number
  exhausted: number
  retried: number
  failure_rate: number
  last_error: string | null
  last_failure_at: string | null
}

export type ErrorCategory =
  | 'stalled'
  | 'lease'
  | 'budget'
  | 'policy'
  | 'routing'
  | 'setup'
  | 'infra'
  | 'cancelled'
  | 'unknown'

export interface ErrorSignature {
  signature: string
  category: ErrorCategory
  count: number
  sources: { step: number; alert: number; run: number }
  run_ids: number[]
  steps: string[]
  pipelines: string[]
  first_seen: string
  last_seen: string
  trend: 'rising' | 'flat' | 'falling' | 'unknown'
  sample: string
}

export interface AlertSummary {
  total: number
  open: number
  resolved: number
  by_kind: Record<string, number>
  open_by_kind: Record<string, number>
  oldest_open_at: string | null
  duplicate_groups: number
}

export type AnomalySeverity = 'high' | 'medium' | 'low'

export interface Anomaly {
  code: string
  severity: AnomalySeverity
  title: string
  detail: string
  evidence: Record<string, unknown>
}

export interface RecentFailure {
  run_id: number
  pipeline: string
  state: string
  error: string | null
  finished_at: string | null
  failed_steps: string[]
}

export interface DiagnosticsReport {
  available: true
  version: 1
  generated_at: string
  database:
    | {
        path?: string
        runs: number
        steps: number
        alerts: number
        events: number
      }
    | undefined
  window: DiagnosticsWindow
  runs: RunTotals
  steps: StepTotals
  pipelines: PipelineHealth[]
  step_health: StepHealth[]
  errors: ErrorSignature[]
  alerts: AlertSummary
  anomalies: Anomaly[]
  recent_failures: RecentFailure[]
}

export interface DiagnosticsUnavailable {
  available: false
  version: 1
  generated_at: string
  reason: string
  database: { path?: string }
}

export type DiagnosticsResult = DiagnosticsReport | DiagnosticsUnavailable

interface RunScanRow {
  id: number
  workspace: string
  state: string
  pipeline_ref: string
  target: string
  enforcement: string
  error: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
  parent_run_id: number | null
}

interface StepScanRow {
  id: number
  run_id: number
  path: string
  name: string
  type: string
  status: string
  attempt: number
  max_attempts: number
  error: string | null
  result: string | null
  model: string | null
  provider: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

interface AlertScanRow {
  id: number
  run_id: number
  step_path: string | null
  kind: string
  title: string
  body: string
  status: string
  created_at: string
  resolved_at: string | null
}

interface EventCountRow {
  run_id: number
  type: string
  count: number
}

interface AdapterScanRow {
  id: string
  harness: string
  workspace: string
  capabilities: string
  heartbeat_at: string
}

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_STATES = new Set(['queued', 'running', 'waiting'])
const ADAPTER_STALE_MS = 120_000
const STALE_RUN_MS = 10 * 60_000

const DAY_MS = 24 * 60 * 60_000

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const from = Date.parse(start)
  const to = Date.parse(end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return (to - from) / 1000
}

function timestamp(value: string | null | undefined, fallback: Date): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback.getTime()
}

function normalizeError(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b(?:run|step|alert|child|parent)\s*#?\d+\b/g, '<ref>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

export function errorCategory(value: string): ErrorCategory {
  const text = value.toLowerCase()
  if (/stalled|heartbeat|stopped reporting|no heartbeat/.test(text)) return 'stalled'
  if (/lease expired|lease\b|expired lease/.test(text)) return 'lease'
  if (/turn limit|token limit|tool.?call limit|budget|exceeded|violation limit/.test(text))
    return 'budget'
  if (/policy|denied|not allowed|not permitted|forbidden/.test(text)) return 'policy'
  if (/route|router|missing control call|control call|unknown route/.test(text)) return 'routing'
  if (/adapter|enforcement|config|workspace|model|provider|missing|not found/.test(text))
    return 'setup'
  if (/timeout|timed out|network|econn|fetch failed|socket|connection/.test(text)) return 'infra'
  if (/cancel/.test(text)) return 'cancelled'
  return 'unknown'
}

function routeOf(path: string): string | undefined {
  const matches = [...path.matchAll(/\/route-([^/]+)/g)]
  return matches.at(-1)?.[1]
}

function selectPipeline(
  run: RunScanRow,
  routes: Map<number, { route: string; depth: number }>
): string {
  const best = routes.get(run.id)
  return best?.route ?? run.pipeline_ref
}

function isTaskLike(step: StepScanRow): boolean {
  return step.type === 'task' || step.type === 'router'
}

function incidentTime(step: StepScanRow): string {
  return step.finished_at ?? step.updated_at ?? step.created_at
}

function severityRank(value: AnomalySeverity): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2
}

/** Open a SQLite database read-only and analyze it without mutating the file. */
export function analyzeDatabaseFile(
  path: string,
  options: DiagnosticsOptions = {}
): DiagnosticsResult {
  if (!existsSync(path)) {
    return {
      available: false,
      version: 1,
      generated_at: (options.now ?? new Date()).toISOString(),
      reason: `no orchestrator database at ${path}`,
      database: { path },
    }
  }
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    return analyzeDatabase(db, { ...options, path })
  } finally {
    db.close()
  }
}

export function analyzeDatabase(
  db: Database.Database,
  options: DiagnosticsOptions = {}
): DiagnosticsReport {
  const now = options.now ?? new Date()
  const days = Number.isFinite(options.days) ? Number(options.days) : 30
  const since = days > 0 ? new Date(now.getTime() - days * DAY_MS).toISOString() : null
  const until = now.toISOString()

  const runRows = (
    since
      ? db
          .prepare(
            `SELECT id, workspace, state, pipeline_ref, target, enforcement, error,
                    created_at, updated_at, finished_at, parent_run_id
             FROM runs WHERE created_at >= ? ORDER BY id`
          )
          .all(since)
      : db
          .prepare(
            `SELECT id, workspace, state, pipeline_ref, target, enforcement, error,
                    created_at, updated_at, finished_at, parent_run_id
             FROM runs ORDER BY id`
          )
          .all()
  ) as RunScanRow[]

  const stepRows = (
    since
      ? db
          .prepare(
            `SELECT s.id, s.run_id, s.path, s.name, s.type, s.status, s.attempt,
                    s.max_attempts, s.error, s.result, s.model, s.provider,
                    s.started_at, s.finished_at, s.created_at, s.updated_at
             FROM steps s JOIN runs r ON r.id = s.run_id
             WHERE r.created_at >= ? ORDER BY s.id`
          )
          .all(since)
      : db
          .prepare(
            `SELECT s.id, s.run_id, s.path, s.name, s.type, s.status, s.attempt,
                    s.max_attempts, s.error, s.result, s.model, s.provider,
                    s.started_at, s.finished_at, s.created_at, s.updated_at
             FROM steps s ORDER BY s.id`
          )
          .all()
  ) as StepScanRow[]

  const alertRows = (
    since
      ? db
          .prepare(
            `SELECT id, run_id, step_path, kind, title, body, status, created_at, resolved_at
             FROM alerts WHERE created_at >= ? ORDER BY id`
          )
          .all(since)
      : db
          .prepare(
            `SELECT id, run_id, step_path, kind, title, body, status, created_at, resolved_at
             FROM alerts ORDER BY id`
          )
          .all()
  ) as AlertScanRow[]

  const eventRows = (
    since
      ? db
          .prepare(
            `SELECT run_id, type, COUNT(*) AS count FROM events
             WHERE created_at >= ? GROUP BY run_id, type`
          )
          .all(since)
      : db.prepare('SELECT run_id, type, COUNT(*) AS count FROM events GROUP BY run_id, type').all()
  ) as EventCountRow[]

  const adapterRows = db
    .prepare('SELECT id, harness, workspace, capabilities, heartbeat_at FROM adapters')
    .all() as AdapterScanRow[]

  const database = {
    ...(options.path ? { path: options.path } : {}),
    runs: Number(
      (db.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }).count
    ),
    steps: Number(
      (db.prepare('SELECT COUNT(*) AS count FROM steps').get() as { count: number }).count
    ),
    alerts: Number(
      (db.prepare('SELECT COUNT(*) AS count FROM alerts').get() as { count: number }).count
    ),
    events: Number(
      (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count
    ),
  }

  const stepsByRun = new Map<number, StepScanRow[]>()
  for (const step of stepRows) {
    const list = stepsByRun.get(step.run_id)
    if (list) list.push(step)
    else stepsByRun.set(step.run_id, [step])
  }

  const routes = new Map<number, { route: string; depth: number }>()
  for (const step of stepRows) {
    const route = routeOf(step.path)
    if (!route) continue
    const depth = step.path.split('/').length
    const current = routes.get(step.run_id)
    if (!current || depth >= current.depth) routes.set(step.run_id, { route, depth })
  }

  const pipelineByRun = new Map<number, string>()
  for (const run of runRows) {
    pipelineByRun.set(run.id, selectPipeline(run, routes))
  }

  const runStates: Record<string, number> = {}
  let completed = 0
  let failed = 0
  let cancelled = 0
  let active = 0
  let lastFailureAt: string | null = null
  const durations: number[] = []
  for (const run of runRows) {
    runStates[run.state] = (runStates[run.state] ?? 0) + 1
    if (run.state === 'completed') completed++
    if (run.state === 'failed') {
      failed++
      const at = run.finished_at ?? run.updated_at
      if (!lastFailureAt || Date.parse(at) > Date.parse(lastFailureAt)) lastFailureAt = at
    }
    if (run.state === 'cancelled') cancelled++
    if (ACTIVE_STATES.has(run.state)) active++
    if (TERMINAL_STATES.has(run.state)) {
      const duration = secondsBetween(run.created_at, run.finished_at)
      if (duration !== null) durations.push(duration)
    }
  }

  const stepStates: Record<string, number> = {}
  let failedSteps = 0
  let retriedSteps = 0
  let exhaustedSteps = 0
  let attempts = 0
  for (const step of stepRows) {
    stepStates[step.status] = (stepStates[step.status] ?? 0) + 1
    attempts += Number(step.attempt)
    if (step.status === 'failed') {
      failedSteps++
      if (Number(step.attempt) >= Number(step.max_attempts)) exhaustedSteps++
    }
    if (Number(step.attempt) > 1) retriedSteps++
  }

  const openAlertsByRun = new Map<number, number>()
  for (const alert of alertRows) {
    if (alert.status !== 'open') continue
    openAlertsByRun.set(alert.run_id, (openAlertsByRun.get(alert.run_id) ?? 0) + 1)
  }

  const pipelineMap = new Map<
    string,
    {
      entry: string
      runs: number
      completed: number
      failed: number
      cancelled: number
      active: number
      steps: number
      failedSteps: number
      openAlerts: number
      lastFailureAt: string | null
    }
  >()
  for (const run of runRows) {
    const pipeline = pipelineByRun.get(run.id) ?? run.pipeline_ref
    const entry = pipelineMap.get(pipeline) ?? {
      entry: run.pipeline_ref,
      runs: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      active: 0,
      steps: 0,
      failedSteps: 0,
      openAlerts: 0,
      lastFailureAt: null,
    }
    entry.runs++
    if (run.state === 'completed') entry.completed++
    if (run.state === 'failed') {
      entry.failed++
      const at = run.finished_at ?? run.updated_at
      if (!entry.lastFailureAt || Date.parse(at) > Date.parse(entry.lastFailureAt)) {
        entry.lastFailureAt = at
      }
    }
    if (run.state === 'cancelled') entry.cancelled++
    if (ACTIVE_STATES.has(run.state)) entry.active++
    const runSteps = stepsByRun.get(run.id) ?? []
    entry.steps += runSteps.length
    entry.failedSteps += runSteps.filter((step) => step.status === 'failed').length
    entry.openAlerts += openAlertsByRun.get(run.id) ?? 0
    pipelineMap.set(pipeline, entry)
  }

  const pipelines: PipelineHealth[] = [...pipelineMap.entries()]
    .map(([pipeline, entry]) => ({
      pipeline,
      entry: entry.entry,
      runs: entry.runs,
      completed: entry.completed,
      failed: entry.failed,
      cancelled: entry.cancelled,
      active: entry.active,
      failure_rate: rate(entry.failed, entry.completed + entry.failed),
      steps: entry.steps,
      failed_steps: entry.failedSteps,
      open_alerts: entry.openAlerts,
      last_failure_at: entry.lastFailureAt,
    }))
    .sort((left, right) => right.failed - left.failed || right.runs - left.runs)
    .slice(0, 25)

  const stepGroups = new Map<
    string,
    {
      pipeline: string
      name: string
      path: string
      steps: number
      runs: Set<number>
      failures: number
      exhausted: number
      retried: number
      lastError: string | null
      lastFailureAt: string | null
    }
  >()
  for (const step of stepRows) {
    const pipeline = pipelineByRun.get(step.run_id) ?? 'unknown'
    const key = `${pipeline}\u0000${step.name}`
    const group = stepGroups.get(key) ?? {
      pipeline,
      name: step.name,
      path: step.path,
      steps: 0,
      runs: new Set<number>(),
      failures: 0,
      exhausted: 0,
      retried: 0,
      lastError: null,
      lastFailureAt: null,
    }
    group.steps++
    group.runs.add(step.run_id)
    if (Number(step.attempt) > 1) group.retried++
    if (step.status === 'failed') {
      group.failures++
      if (Number(step.attempt) >= Number(step.max_attempts)) group.exhausted++
      const at = incidentTime(step)
      if (!group.lastFailureAt || Date.parse(at) > Date.parse(group.lastFailureAt)) {
        group.lastFailureAt = at
        group.lastError = step.error
      }
      if (pipelineByRun.get(step.run_id) === pipeline) group.path = step.path
    }
    stepGroups.set(key, group)
  }

  const stepHealth: StepHealth[] = [...stepGroups.values()]
    .filter((group) => group.failures > 0 || group.retried > 0)
    .map((group) => ({
      pipeline: group.pipeline,
      name: group.name,
      path: group.path,
      steps: group.steps,
      runs: group.runs.size,
      failures: group.failures,
      exhausted: group.exhausted,
      retried: group.retried,
      failure_rate: rate(group.failures, group.steps),
      last_error: group.lastError,
      last_failure_at: group.lastFailureAt,
    }))
    .sort(
      (left, right) =>
        right.failures - left.failures ||
        right.exhausted - left.exhausted ||
        right.retried - left.retried
    )
    .slice(0, 40)

  const midpoint = since
    ? Date.parse(since) + (Date.parse(until) - Date.parse(since)) / 2
    : Number.NaN
  const errors = new Map<
    string,
    {
      signature: string
      category: ErrorCategory
      count: number
      sources: { step: number; alert: number; run: number }
      runIDs: Set<number>
      steps: Set<string>
      pipelines: Set<string>
      first: string
      last: string
      firstHalf: number
      secondHalf: number
      sample: string
    }
  >()

  const addError = (
    value: string,
    at: string,
    runID: number | null,
    stepName: string | null,
    source: 'step' | 'alert' | 'run'
  ): void => {
    const text = value.trim()
    if (!text) return
    const signature = normalizeError(text)
    const entry = errors.get(signature) ?? {
      signature,
      category: errorCategory(text),
      count: 0,
      sources: { step: 0, alert: 0, run: 0 },
      runIDs: new Set<number>(),
      steps: new Set<string>(),
      pipelines: new Set<string>(),
      first: at,
      last: at,
      firstHalf: 0,
      secondHalf: 0,
      sample: text.slice(0, 240),
    }
    entry.count++
    entry.sources[source]++
    entry.category = errorCategory(text)
    if (runID !== null) {
      entry.runIDs.add(runID)
      const pipeline = pipelineByRun.get(runID)
      if (pipeline) entry.pipelines.add(pipeline)
    }
    if (stepName) entry.steps.add(stepName)
    if (Date.parse(at) < Date.parse(entry.first)) entry.first = at
    if (Date.parse(at) > Date.parse(entry.last)) entry.last = at
    const time = timestamp(at, now)
    if (Number.isFinite(midpoint) && time < midpoint) entry.firstHalf++
    else if (Number.isFinite(midpoint)) entry.secondHalf++
    errors.set(signature, entry)
  }

  for (const step of stepRows) {
    if (!step.error) continue
    addError(step.error, incidentTime(step), step.run_id, step.name, 'step')
  }
  for (const alert of alertRows) {
    addError(alert.body, alert.created_at, alert.run_id, alert.step_path, 'alert')
  }
  for (const run of runRows) {
    if (!run.error || (run.state !== 'failed' && run.state !== 'cancelled')) continue
    addError(run.error, run.finished_at ?? run.updated_at, run.id, null, 'run')
  }

  const errorSignatures: ErrorSignature[] = [...errors.values()]
    .map((entry) => {
      const trend: ErrorSignature['trend'] =
        entry.count < 3 || !Number.isFinite(midpoint)
          ? 'unknown'
          : entry.secondHalf >= Math.max(3, entry.firstHalf * 1.5)
            ? 'rising'
            : entry.firstHalf >= Math.max(3, entry.secondHalf * 1.5)
              ? 'falling'
              : 'flat'
      return {
        signature: entry.signature,
        category: entry.category,
        count: entry.count,
        sources: entry.sources,
        run_ids: [...entry.runIDs].sort((left, right) => left - right).slice(0, 20),
        steps: [...entry.steps].slice(0, 20),
        pipelines: [...entry.pipelines].slice(0, 10),
        first_seen: entry.first,
        last_seen: entry.last,
        trend,
        sample: entry.sample,
      }
    })
    .sort((left, right) => right.count - left.count)
    .slice(0, 30)

  const byKind: Record<string, number> = {}
  const openByKind: Record<string, number> = {}
  let open = 0
  let resolved = 0
  let oldestOpenAt: string | null = null
  const duplicateKeys = new Map<string, number>()
  for (const alert of alertRows) {
    byKind[alert.kind] = (byKind[alert.kind] ?? 0) + 1
    if (alert.status === 'open') {
      open++
      openByKind[alert.kind] = (openByKind[alert.kind] ?? 0) + 1
      if (!oldestOpenAt || Date.parse(alert.created_at) < Date.parse(oldestOpenAt)) {
        oldestOpenAt = alert.created_at
      }
    } else if (alert.status === 'resolved') {
      resolved++
    }
    const key = `${alert.kind}\u0000${alert.step_path ?? ''}\u0000${alert.title}\u0000${alert.body}`
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1)
  }
  const duplicateGroups = [...duplicateKeys.values()].filter((count) => count > 1).length

  const alerts: AlertSummary = {
    total: alertRows.length,
    open,
    resolved,
    by_kind: byKind,
    open_by_kind: openByKind,
    oldest_open_at: oldestOpenAt,
    duplicate_groups: duplicateGroups,
  }

  const eventCounts = new Map<string, number>()
  for (const row of eventRows) {
    eventCounts.set(`${row.run_id}\u0000${row.type}`, Number(row.count))
  }
  const eventCount = (runID: number, type: string): number => {
    return eventCounts.get(`${runID}\u0000${type}`) ?? 0
  }

  const anomalies: Anomaly[] = []
  const addAnomaly = (
    code: string,
    severity: AnomalySeverity,
    title: string,
    detail: string,
    evidence: Record<string, unknown>
  ): void => {
    anomalies.push({ code, severity, title, detail, evidence })
  }

  const terminalStorm: Array<{ run_id: number; type: string; count: number }> = []
  for (const run of runRows) {
    for (const type of ['run.failed', 'run.completed', 'run.cancelled']) {
      const count = eventCount(run.id, type)
      if (count > 1) terminalStorm.push({ run_id: run.id, type, count })
    }
  }
  if (terminalStorm.length) {
    terminalStorm.sort((left, right) => right.count - left.count)
    const worst = terminalStorm[0]
    addAnomaly(
      'terminal_event_storm',
      worst.count > 5 ? 'high' : 'medium',
      'Duplicate terminal run events',
      `${terminalStorm.length} run(s) emitted the same terminal event more than once; the worst emitted ${worst.count} ${worst.type} events.`,
      { runs: terminalStorm.slice(0, 5), total: terminalStorm.length }
    )
  }

  const exhausted = stepRows.filter(
    (step) => step.status === 'failed' && Number(step.attempt) >= Number(step.max_attempts)
  )
  if (exhausted.length) {
    addAnomaly(
      'retry_exhaustion',
      exhausted.length >= 3 ? 'high' : 'medium',
      'Steps exhausted their retries',
      `${exhausted.length} step(s) failed on their final attempt.`,
      {
        steps: [...new Set(exhausted.slice(0, 8).map((step) => `${step.name} (${step.path})`))],
      }
    )
  }

  const stalledAlerts = alertRows.filter(
    (alert) => alert.kind === 'stalled' || errorCategory(alert.body) === 'stalled'
  ).length
  if (alertRows.length >= 3 && stalledAlerts / alertRows.length >= 0.5) {
    addAnomaly(
      'stalled_dominance',
      'high',
      'Stalled work dominates alerts',
      `${stalledAlerts} of ${alertRows.length} alerts concern stalled heartbeats or expired leases.`,
      {
        stalled: stalledAlerts,
        total: alertRows.length,
        ratio: rate(stalledAlerts, alertRows.length),
      }
    )
  }

  const oldestOpenAgeMs = oldestOpenAt ? now.getTime() - Date.parse(oldestOpenAt) : 0
  if (open > 0 && (open >= 5 || oldestOpenAgeMs > DAY_MS)) {
    addAnomaly(
      'open_alert_backlog',
      open >= 10 ? 'high' : 'medium',
      'Open alert backlog',
      `${open} alert(s) remain open${oldestOpenAt ? `; the oldest is ${Math.round(oldestOpenAgeMs / 3_600_000)}h old` : ''}.`,
      { open, oldest_open_at: oldestOpenAt }
    )
  }

  if (duplicateGroups > 0) {
    addAnomaly(
      'duplicate_alerts',
      'medium',
      'Duplicate alerts',
      `${duplicateGroups} alert group(s) repeat the same kind, step, title, and body.`,
      { groups: duplicateGroups }
    )
  }

  if (runRows.length >= 3 && completed === 0) {
    addAnomaly(
      'no_completions',
      'high',
      'No completed runs in the window',
      `${runRows.length} run(s) started but none completed.`,
      { runs: runRows.length, failed, cancelled, active }
    )
  }

  const missingModels = stepRows.filter(
    (step) => isTaskLike(step) && (!step.model || !step.provider)
  )
  if (missingModels.length) {
    const names = [...new Set(missingModels.map((step) => step.name))]
    addAnomaly(
      'missing_model_provider',
      'low',
      'Steps lack a model or provider',
      `${missingModels.length} step row(s) have no model or no provider across ${names.length} step name(s).`,
      { steps: names.slice(0, 10), rows: missingModels.length }
    )
  }

  const staleAdapters = adapterRows.filter(
    (adapter) => now.getTime() - Date.parse(adapter.heartbeat_at) > ADAPTER_STALE_MS
  )
  const strictRuns = runRows.filter((run) => run.enforcement === 'strict').length
  if (staleAdapters.length) {
    addAnomaly(
      'stale_adapter',
      'high',
      'Enforcement adapter is stale',
      `${staleAdapters.length} registered adapter(s) have a heartbeat older than ${Math.round(ADAPTER_STALE_MS / 1000)}s.`,
      {
        adapters: staleAdapters.slice(0, 5).map((adapter) => ({
          id: adapter.id,
          harness: adapter.harness,
          workspace: adapter.workspace,
          heartbeat_at: adapter.heartbeat_at,
        })),
      }
    )
  } else if (!adapterRows.length && strictRuns > 0) {
    addAnomaly(
      'adapter_missing',
      'high',
      'Strict runs without a registered adapter',
      `${strictRuns} strict run(s) exist but no adapter is registered.`,
      { strict_runs: strictRuns }
    )
  }

  const watchdogChurn: Array<{ run_id: number; count: number }> = []
  for (const run of runRows) {
    const count = eventCount(run.id, 'watchdog.retry')
    if (count > 3) watchdogChurn.push({ run_id: run.id, count })
  }
  if (watchdogChurn.length) {
    watchdogChurn.sort((left, right) => right.count - left.count)
    addAnomaly(
      'watchdog_churn',
      'medium',
      'Watchdog retried the same run repeatedly',
      `${watchdogChurn.length} run(s) were retried by the watchdog more than three times; the worst had ${watchdogChurn[0].count}.`,
      { runs: watchdogChurn.slice(0, 5) }
    )
  }

  const staleActive = runRows.filter(
    (run) =>
      ACTIVE_STATES.has(run.state) && now.getTime() - Date.parse(run.updated_at) > STALE_RUN_MS
  )
  if (staleActive.length) {
    addAnomaly(
      'stale_active_runs',
      'medium',
      'Active runs stopped updating',
      `${staleActive.length} run(s) are still marked active but have not updated in over ${Math.round(STALE_RUN_MS / 60_000)} minutes.`,
      {
        runs: staleActive
          .slice(0, 5)
          .map((run) => ({ run_id: run.id, state: run.state, updated_at: run.updated_at })),
      }
    )
  }

  const zeroStepRuns = runRows.filter((run) => (stepsByRun.get(run.id)?.length ?? 0) === 0)
  if (zeroStepRuns.length) {
    addAnomaly(
      'runs_without_steps',
      'low',
      'Runs have no step rows',
      `${zeroStepRuns.length} run(s) have no recorded steps.`,
      { runs: zeroStepRuns.slice(0, 5).map((run) => run.id) }
    )
  }

  anomalies.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.code.localeCompare(right.code)
  )

  const recentFailures: RecentFailure[] = runRows
    .filter((run) => run.state === 'failed')
    .sort(
      (left, right) =>
        Date.parse(right.finished_at ?? right.updated_at) -
        Date.parse(left.finished_at ?? left.updated_at)
    )
    .slice(0, 10)
    .map((run) => ({
      run_id: run.id,
      pipeline: pipelineByRun.get(run.id) ?? run.pipeline_ref,
      state: run.state,
      error: run.error,
      finished_at: run.finished_at ?? run.updated_at,
      failed_steps: (stepsByRun.get(run.id) ?? [])
        .filter((step) => step.status === 'failed')
        .map((step) => step.name),
    }))

  const average = (values: number[]): number | null =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null

  return {
    available: true,
    version: 1,
    generated_at: until,
    database,
    window: { days, since, until },
    runs: {
      total: runRows.length,
      by_state: runStates,
      completed,
      failed,
      cancelled,
      active,
      failure_rate: rate(failed, completed + failed),
      avg_duration_seconds: average(durations),
      last_failure_at: lastFailureAt,
    },
    steps: {
      total: stepRows.length,
      by_status: stepStates,
      failed: failedSteps,
      retried: retriedSteps,
      exhausted: exhaustedSteps,
      avg_attempts: stepRows.length ? Math.round((attempts / stepRows.length) * 10) / 10 : 0,
    },
    pipelines,
    step_health: stepHealth,
    errors: errorSignatures,
    alerts,
    anomalies,
    recent_failures: recentFailures,
  }
}

/** Counts and categories shared by the CLI and tests. */
export function summarizeDiagnostics(report: DiagnosticsReport): string[] {
  const lines = [
    `window: ${report.window.days > 0 ? `${report.window.days} days` : 'all history'} (${report.runs.total} runs, ${report.steps.total} steps)`,
    `runs: ${report.runs.completed} completed, ${report.runs.failed} failed, ${report.runs.cancelled} cancelled, ${report.runs.active} active (${report.runs.failure_rate}% failure rate)`,
    `steps: ${report.steps.failed} failed, ${report.steps.retried} retried, ${report.steps.exhausted} exhausted`,
    `alerts: ${report.alerts.open} open of ${report.alerts.total}`,
  ]
  for (const anomaly of report.anomalies) {
    lines.push(`[${anomaly.severity}] ${anomaly.code}: ${anomaly.detail}`)
  }
  return lines
}
