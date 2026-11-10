import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { AlertRow, RunRow, StepAttemptRow, StepRow } from './store.ts'

const RESULT_LIMIT = 8_000
const ERROR_LIMIT = 2_000
const STEPS_LIMIT = 100
const ATTEMPTS_LIMIT = 200

export type EvidenceSource = 'database' | 'service'

export interface EvidenceRun {
  id: number
  workspace: string
  target: string
  state: string
  root_run_id: number
  parent_run_id: number | null
  parent_step_path: string | null
  origin_agent: string | null
  origin_harness: string | null
  pipeline_ref: string
  enforcement: string
  created_at: string
  finished_at: string | null
  error: string | null
}

export interface EvidenceStep {
  path: string
  parent_path: string | null
  name: string
  type: string
  status: string
  attempt: number
  max_attempts: number
  result: string | null
  error: string | null
  recovery_cycles: number
  recovered: number
  recovered_by: string | null
  started_at: string | null
  finished_at: string | null
}

export interface EvidenceAttempt {
  step_path: string
  attempt: number
  status: string
  exit_code: number | null
  error: string | null
  result: string | null
  turns: number
  tokens: number
  tool_calls: number
  violations: number
  started_at: string | null
  finished_at: string | null
}

export interface EvidenceAlert {
  id: number
  step_path: string | null
  kind: string
  title: string
  body: string
  status: string
  created_at: string
  resolved_at: string | null
}

export interface EvidenceFailure {
  step_path: string
  name: string
  type: string
  attempt: number
  status: string
  exit_code: number | null
  error: string | null
  result: string | null
}

export interface RunEvidence {
  available: boolean
  source: EvidenceSource
  reason?: string
  run: EvidenceRun | null
  root: EvidenceRun | null
  steps: EvidenceStep[]
  attempts: EvidenceAttempt[]
  alerts: EvidenceAlert[]
  children: EvidenceRun[]
  failure: EvidenceFailure | null
}

export interface EvidenceInput {
  source: EvidenceSource
  run: RunRow
  root?: RunRow | null
  steps: StepRow[]
  attempts: StepAttemptRow[]
  alerts: AlertRow[]
  children?: RunRow[]
}

function clip(value: string | null | undefined, limit: number): string | null {
  if (value === null || value === undefined) return null
  return value.length > limit ? `${value.slice(0, limit)}\n… truncated` : value
}

function sanitizeRun(run: RunRow): EvidenceRun {
  return {
    id: Number(run.id),
    workspace: run.workspace,
    target: run.target,
    state: run.state,
    root_run_id: Number(run.root_run_id),
    parent_run_id: run.parent_run_id === null ? null : Number(run.parent_run_id),
    parent_step_path: run.parent_step_path,
    origin_agent: run.origin_agent,
    origin_harness: run.origin_harness,
    pipeline_ref: run.pipeline_ref,
    enforcement: run.enforcement,
    created_at: run.created_at,
    finished_at: run.finished_at,
    error: clip(run.error, ERROR_LIMIT),
  }
}

function sanitizeStep(step: StepRow): EvidenceStep {
  return {
    path: step.path,
    parent_path: step.parent_path,
    name: step.name,
    type: step.type,
    status: step.status,
    attempt: Number(step.attempt),
    max_attempts: Number(step.max_attempts),
    result: clip(step.result, RESULT_LIMIT),
    error: clip(step.error, ERROR_LIMIT),
    recovery_cycles: Number(step.recovery_cycles ?? 0),
    recovered: Number(step.recovered ?? 0),
    recovered_by: step.recovered_by ?? null,
    started_at: step.started_at,
    finished_at: step.finished_at,
  }
}

function sanitizeAttempt(attempt: StepAttemptRow): EvidenceAttempt {
  return {
    step_path: attempt.step_path,
    attempt: Number(attempt.attempt),
    status: attempt.status,
    exit_code: attempt.exit_code === null ? null : Number(attempt.exit_code),
    error: clip(attempt.error, ERROR_LIMIT),
    result: clip(attempt.result, RESULT_LIMIT),
    turns: Number(attempt.turns),
    tokens: Number(attempt.tokens),
    tool_calls: Number(attempt.tool_calls),
    violations: Number(attempt.violations),
    started_at: attempt.started_at,
    finished_at: attempt.finished_at,
  }
}

function sanitizeAlert(alert: AlertRow): EvidenceAlert {
  return {
    id: Number(alert.id),
    step_path: alert.step_path,
    kind: alert.kind,
    title: alert.title,
    body: clip(alert.body, ERROR_LIMIT) ?? '',
    status: alert.status,
    created_at: alert.created_at,
    resolved_at: alert.resolved_at,
  }
}

function pickFailure(steps: EvidenceStep[], attempts: EvidenceAttempt[]): EvidenceFailure | null {
  const failed =
    steps.find(
      (step) =>
        step.status === 'failed' &&
        step.error &&
        (step.type === 'agent' || step.type === 'script' || step.type === 'router')
    ) ??
    steps.find((step) => step.status === 'failed' && step.error) ??
    steps.find((step) => step.status === 'failed')
  if (!failed) return null
  const attempt =
    [...attempts]
      .reverse()
      .find(
        (entry) =>
          entry.step_path === failed.path &&
          (entry.status === 'failed' || entry.status === 'retry' || entry.error)
      ) ?? [...attempts].reverse().find((entry) => entry.step_path === failed.path)
  return {
    step_path: failed.path,
    name: failed.name,
    type: failed.type,
    attempt: Number(attempt?.attempt ?? failed.attempt),
    status: attempt?.status ?? failed.status,
    exit_code: attempt?.exit_code ?? null,
    error: attempt?.error ?? failed.error,
    result: attempt?.result ?? failed.result,
  }
}

export function buildEvidence(input: EvidenceInput): RunEvidence {
  const steps = input.steps.slice(0, STEPS_LIMIT).map(sanitizeStep)
  const attempts = input.attempts.slice(-ATTEMPTS_LIMIT).map(sanitizeAttempt)
  return {
    available: true,
    source: input.source,
    run: sanitizeRun(input.run),
    root: input.root ? sanitizeRun(input.root) : null,
    steps,
    attempts,
    alerts: input.alerts.map(sanitizeAlert),
    children: (input.children ?? []).map(sanitizeRun),
    failure: pickFailure(steps, attempts),
  }
}

export function readRunEvidenceFile(
  path: string,
  options: { runId?: number; workspace?: string; now?: Date } = {}
): RunEvidence {
  if (!existsSync(path)) {
    return {
      available: false,
      source: 'database',
      reason: `no orchestrator database at ${path}`,
      run: null,
      root: null,
      steps: [],
      attempts: [],
      alerts: [],
      children: [],
      failure: null,
    }
  }
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    return readRunEvidence(db, options)
  } finally {
    db.close()
  }
}

export function readRunEvidence(
  db: Database.Database,
  options: { runId?: number; workspace?: string } = {}
): RunEvidence {
  let run: RunRow | undefined
  if (options.runId !== undefined) {
    run = db.prepare('SELECT * FROM runs WHERE id = ?').get(options.runId) as RunRow | undefined
  } else {
    const workspace = options.workspace?.trim()
    run = (
      workspace
        ? db
            .prepare(
              "SELECT * FROM runs WHERE state = 'failed' AND parent_run_id IS NULL AND workspace = ? ORDER BY id DESC LIMIT 1"
            )
            .get(workspace)
        : db
            .prepare(
              "SELECT * FROM runs WHERE state = 'failed' AND parent_run_id IS NULL ORDER BY id DESC LIMIT 1"
            )
            .get()
    ) as RunRow | undefined
  }
  if (!run) {
    return {
      available: false,
      source: 'database',
      reason:
        options.runId !== undefined
          ? `run ${options.runId} does not exist`
          : 'no failed root run is recorded for this workspace',
      run: null,
      root: null,
      steps: [],
      attempts: [],
      alerts: [],
      children: [],
      failure: null,
    }
  }
  const runID = Number(run.id)
  const rootRun =
    run.root_run_id && Number(run.root_run_id) !== runID
      ? (db.prepare('SELECT * FROM runs WHERE id = ?').get(run.root_run_id) as RunRow | undefined)
      : run
  const steps = db
    .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY id LIMIT ?')
    .all(runID, STEPS_LIMIT) as StepRow[]
  const attempts = db
    .prepare('SELECT * FROM step_attempts WHERE run_id = ? ORDER BY attempt, id LIMIT ?')
    .all(runID, ATTEMPTS_LIMIT) as StepAttemptRow[]
  const alerts = db
    .prepare('SELECT * FROM alerts WHERE run_id = ? ORDER BY id')
    .all(runID) as AlertRow[]
  const children = db
    .prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY id')
    .all(runID) as RunRow[]
  return buildEvidence({
    source: 'database',
    run,
    root: rootRun ?? run,
    steps,
    attempts,
    alerts,
    children,
  })
}

/** Parse `run 42`, `#42`, or a bare run id from a request file. */
export function runIdFromRequest(text: string): number | undefined {
  const match = String(text ?? '').match(/(?:run|#)\s*#?(\d+)\b/i)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
