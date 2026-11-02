// Clara — daemon run tracking.
//
// The daemon is the only component that launches worker sessions. `runs` is
// the record of which session owns which stage, so a restart does not launch a
// second copy. `daemon_lock` keeps one process ticking when OpenCode loads the
// plugin in several locations.
//
// Everything here is deterministic SQL. The model is only involved after a
// stage session has been created, never in deciding whether to create it.

import { now, type Db, type Row } from './db.ts'
import {
  evaluateCondition,
  pipelineForRequest,
  type PipelineStage,
  type StageRole,
} from './pipeline.ts'
import { stageEvidence, stageGateVerified } from './queries.ts'

export type RunStatus = 'starting' | 'running' | 'done' | 'failed' | 'interrupted'

export interface RunRow {
  id: number
  request_id: number
  stage: string
  agent: string
  role: StageRole
  session_id: string | null
  status: RunStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  note: string | null
}

export interface RunWithRequest extends RunRow {
  request_state: string
  request_slug: string
}

export interface StageStep {
  kind: 'stage'
  stage: PipelineStage
  reason: string
}

export interface TransitionStep {
  kind: 'transition'
  state: 'running' | 'review' | 'completed'
  reason: string
}

export type NextStep = StageStep | TransitionStep

// ---------------------------------------------------------------------------
// request predicates
// ---------------------------------------------------------------------------

export function hasCriteria(db: Db, requestID: number): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM criteria WHERE request_id = ?').get(requestID)
  return Number(row?.c ?? 0) > 0
}

export function hasOpenDecision(db: Db, requestID: number): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM decisions WHERE request_id = ? AND resolved_at IS NULL LIMIT 1')
      .get(requestID)
  )
}

/** Active requests, in creation order. */
export function activeRequests(db: Db): Row[] {
  return db
    .prepare(
      `SELECT * FROM requests
        WHERE state IN ('draft', 'approved', 'running', 'review')
        ORDER BY id`
    )
    .all()
}

type StageStatus = 'completed' | 'skipped'

function stageStatuses(db: Db, requestID: number): Map<string, StageStatus> {
  const rows = db
    .prepare(
      `SELECT type, payload FROM events
        WHERE request_id = ? AND type IN ('stage.completed', 'stage.skipped')
        ORDER BY id`
    )
    .all(requestID) as Row[]
  const statuses = new Map<string, StageStatus>()
  for (const row of rows) {
    let payload: any
    try {
      payload = JSON.parse(String(row.payload ?? '{}'))
    } catch {
      continue
    }
    if (typeof payload?.stage === 'string') {
      statuses.set(payload.stage, row.type === 'stage.completed' ? 'completed' : 'skipped')
    }
  }
  return statuses
}

function skipStage(db: Db, requestID: number, stage: PipelineStage): void {
  const at = now()
  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    requestID,
    at,
    'stage.skipped',
    'ai_0',
    JSON.stringify({ stage: stage.id, reason: 'condition false' })
  )
  db.prepare('UPDATE requests SET last_event_at = ?, stalled_at = NULL WHERE id = ?').run(
    at,
    requestID
  )
}

/**
 * The next stage, transition, or undefined when the request is waiting on a
 * human. This is pure ledger state plus the pinned pipeline; it does not look
 * at sessions.
 */
export function nextStage(db: Db, request: Row): NextStep | undefined {
  if (request.state === 'completed' || request.state === 'cancelled') return
  if (request.stalled_at) return
  if (hasOpenDecision(db, Number(request.id))) return

  const pipeline = pipelineForRequest(db, request)
  const statuses = stageStatuses(db, Number(request.id))
  const evidence = stageEvidence(db, Number(request.id))

  const byPhase = (phase: PipelineStage['phase']): PipelineStage[] =>
    pipeline.stages.filter((stage) => stage.phase === phase)
  const contract = byPhase('contract')[0]
  const work = byPhase('work')
  const review = byPhase('review')
  const close = byPhase('close')[0]

  const pending = (stages: PipelineStage[]): PipelineStage | undefined => {
    for (const stage of stages) {
      if (statuses.has(stage.id)) continue
      if (!evaluateCondition(stage.when, evidence)) {
        skipStage(db, Number(request.id), stage)
        statuses.set(stage.id, 'skipped')
        continue
      }
      if (!gateCleared(db, Number(request.id), stage, pipeline.stages, statuses)) return
      return stage
    }
    return
  }

  const closePending = (): PipelineStage | undefined => {
    if (statuses.has(close.id)) return
    return pending([close])
  }

  switch (request.state) {
    case 'draft': {
      if (!statuses.has(contract.id)) {
        return { kind: 'stage', stage: contract, reason: 'contract not proposed' }
      }
      // Criteria are proposed. Only clara_approve may move this forward.
      return
    }

    case 'approved': {
      const next = pending(work)
      if (next) return { kind: 'stage', stage: next, reason: 'work not started' }
      if (work.some((stage) => !statuses.has(stage.id))) return
      const reviewStage = pending(review)
      if (reviewStage) return { kind: 'stage', stage: reviewStage, reason: 'review pending' }
      if (review.some((stage) => !statuses.has(stage.id))) return
      const closeStage = closePending()
      if (closeStage) return { kind: 'stage', stage: closeStage, reason: 'ready to close' }
      if (!statuses.has(close.id)) return
      return { kind: 'transition', state: 'completed', reason: 'close stage complete' }
    }

    case 'running': {
      const next = pending(work)
      if (next) return { kind: 'stage', stage: next, reason: 'work in progress' }
      if (work.some((stage) => !statuses.has(stage.id))) return
      const reviewStage = pending(review)
      if (reviewStage) return { kind: 'stage', stage: reviewStage, reason: 'work complete' }
      if (review.some((stage) => !statuses.has(stage.id))) return
      const closeStage = closePending()
      if (closeStage) return { kind: 'stage', stage: closeStage, reason: 'ready to close' }
      if (!statuses.has(close.id)) return
      return { kind: 'transition', state: 'completed', reason: 'close stage complete' }
    }

    case 'review': {
      const next = pending(review)
      if (next) return { kind: 'stage', stage: next, reason: 'review stage pending' }
      if (review.some((stage) => !statuses.has(stage.id))) return
      const closeStage = closePending()
      if (closeStage) return { kind: 'stage', stage: closeStage, reason: 'ready to close' }
      if (!statuses.has(close.id)) return
      return { kind: 'transition', state: 'completed', reason: 'close stage complete' }
    }

    default:
      return
  }
}

function gateCleared(
  db: Db,
  requestID: number,
  candidate: PipelineStage,
  pipeline: PipelineStage[],
  statuses: Map<string, StageStatus>
): boolean {
  if (candidate.gate?.position === 'before') {
    if (!stageGateVerified(db, requestID, candidate.id, 'before')) return false
  }

  for (const stage of pipeline) {
    if (stage.id === candidate.id) break
    if (statuses.get(stage.id) !== 'completed') continue
    if (stage.gate?.position === 'after') {
      if (!stageGateVerified(db, requestID, stage.id, 'after')) return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

export function latestRun(db: Db, requestID: number, stage: string): RunRow | undefined {
  return db
    .prepare('SELECT * FROM runs WHERE request_id = ? AND stage = ? ORDER BY id DESC LIMIT 1')
    .get(requestID, stage) as RunRow | undefined
}

export function startRun(
  db: Db,
  requestID: number,
  stage: string,
  agent: string,
  role: StageRole
): number {
  const result = db
    .prepare(
      `INSERT INTO runs (request_id, stage, agent, role, status, created_at)
       VALUES (?, ?, ?, ?, 'starting', ?)`
    )
    .run(requestID, stage, agent, role, now())
  db.prepare('UPDATE requests SET current_stage_id = ? WHERE id = ?').run(stage, requestID)
  return Number(result.lastInsertRowid)
}

export function markRunning(db: Db, runID: number, sessionID: string, note?: string): void {
  db.prepare(
    `UPDATE runs
        SET status = 'running', session_id = ?, started_at = ?, note = ?
      WHERE id = ?`
  ).run(sessionID, now(), note ?? null, runID)
}

export function finishRun(
  db: Db,
  runID: number,
  status: Exclude<RunStatus, 'starting' | 'running'>,
  note?: string
): void {
  db.prepare(
    `UPDATE runs
        SET status = ?, finished_at = ?, note = ?
      WHERE id = ?`
  ).run(status, now(), note ?? null, runID)
}

/** Runs that may still own a live session. */
export function waitingRuns(db: Db): RunWithRequest[] {
  return db
    .prepare(
      `SELECT r.*, f.state AS request_state, f.slug AS request_slug
         FROM runs r
         JOIN requests f ON f.id = r.request_id
        WHERE r.status IN ('starting', 'running')
        ORDER BY r.id`
    )
    .all() as RunWithRequest[]
}

// ---------------------------------------------------------------------------
// daemon lock
// ---------------------------------------------------------------------------

/**
 * Take or renew the single daemon lock. Returns false when another live owner
 * holds it. A heartbeat older than `staleMs` can be taken over, so a crashed
 * server does not block the daemon forever.
 */
export function acquireDaemonLock(db: Db, owner: string, pid: number, staleMs: number): boolean {
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare('SELECT * FROM daemon_lock WHERE id = 1').get()
    const at = now()

    if (!row) {
      db.prepare('INSERT INTO daemon_lock (id, owner, pid, heartbeat_at) VALUES (1, ?, ?, ?)').run(
        owner,
        pid,
        at
      )
      db.exec('COMMIT')
      return true
    }

    const heartbeat = new Date(String(row.heartbeat_at)).getTime()
    const age = Number.isFinite(heartbeat) ? Date.now() - heartbeat : Number.POSITIVE_INFINITY

    if (row.owner !== owner && age < staleMs) {
      db.exec('ROLLBACK')
      return false
    }

    db.prepare('UPDATE daemon_lock SET owner = ?, pid = ?, heartbeat_at = ? WHERE id = 1').run(
      owner,
      pid,
      at
    )
    db.exec('COMMIT')
    return true
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The transaction may already have been rolled back by SQLite.
    }
    throw error
  }
}

export function releaseDaemonLock(db: Db, owner: string): void {
  db.prepare('DELETE FROM daemon_lock WHERE id = 1 AND owner = ?').run(owner)
}
