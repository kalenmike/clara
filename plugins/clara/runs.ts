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

export const STAGES = ['spec', 'test', 'build', 'docs', 'judge'] as const
export type Stage = (typeof STAGES)[number]
export type RunStatus = 'starting' | 'running' | 'done' | 'failed' | 'interrupted'

export interface RunRow {
  id: number
  request_id: number
  stage: Stage
  agent: string
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

export interface NextStage {
  stage: Stage
  agent: string
  reason: string
}

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

/**
 * The next stage a request needs, or undefined when it is waiting on a human.
 * This is pure ledger state; it does not look at sessions.
 */
export function nextStage(db: Db, request: Row): NextStage | undefined {
  if (request.state === 'completed' || request.state === 'cancelled') return
  if (request.stalled_at) return
  if (hasOpenDecision(db, Number(request.id))) return

  switch (request.state) {
    case 'draft':
      if (!hasCriteria(db, Number(request.id))) {
        return { stage: 'spec', agent: '001', reason: 'no acceptance criteria' }
      }
      // Criteria are proposed. Only clara_approve may move this forward.
      return

    case 'approved':
      if (!request.tests_hash) {
        return { stage: 'test', agent: '002', reason: 'tests not frozen' }
      }
      return { stage: 'build', agent: '003', reason: 'tests frozen' }

    case 'running':
      return { stage: 'build', agent: '003', reason: 'running' }

    case 'review': {
      const impact = String(request.docs_impact ?? '')
        .trim()
        .toLowerCase()
      const needsDocs = impact !== '' && impact !== 'none' && impact !== 'n/a' && impact !== 'no'
      if (needsDocs && latestRun(db, Number(request.id), 'docs')?.status !== 'done') {
        return { stage: 'docs', agent: '004', reason: 'docs impact' }
      }
      return { stage: 'judge', agent: 'judge', reason: 'ready to close' }
    }

    default:
      return
  }
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

export function latestRun(db: Db, requestID: number, stage: Stage): RunRow | undefined {
  return db
    .prepare('SELECT * FROM runs WHERE request_id = ? AND stage = ? ORDER BY id DESC LIMIT 1')
    .get(requestID, stage) as RunRow | undefined
}

export function startRun(db: Db, requestID: number, stage: Stage, agent: string): number {
  const result = db
    .prepare(
      `INSERT INTO runs (request_id, stage, agent, status, created_at)
       VALUES (?, ?, ?, 'starting', ?)`
    )
    .run(requestID, stage, agent, now())
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
