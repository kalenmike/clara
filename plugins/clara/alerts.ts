// Clara — the human-wait alert outbox.
//
// The ledger derives one row per exception that needs a person. The home agent
// reads this table read-only and is the only component that delivers it. Rows
// stay after they resolve so delivery can be deduplicated across restarts.
//
// `resolved_at` means the condition no longer needs a person. A one-time alert
// such as a hard kill is inserted already resolved: it should be delivered but
// it must not stay in the open inbox forever.

import { now, type Db, type Row } from './db.ts'

export type AlertKind =
  'decision' | 'stalled' | 'budget' | 'approval' | 'stage_gate' | 'review_gate' | 'cancelled'

export type AlertItem = {
  key: string
  requestId: number
  slug: string
  workspace: string
  kind: AlertKind
  title: string
  body: string
  /** One-time events are delivered but never appear in the open inbox. */
  oneTime?: boolean
}

export type AlertRow = {
  id: number
  key: string
  request_id: number | null
  slug: string | null
  workspace: string | null
  kind: AlertKind
  title: string
  body: string
  created_at: string
  resolved_at: string | null
}

const pad = (n: number): string => String(n).padStart(3, '0')

function label(request: Row): string {
  const workspace = request.workspace ? ` [${request.workspace}]` : ''
  return `${pad(Number(request.id))} ${request.slug}${workspace}`
}

/**
 * Every non-terminal state that needs a person. This is the same set the
 * Clara inbox shows; terminal kills are separate one-time alerts.
 */
export function pendingHumanWork(db: Db): AlertItem[] {
  const items: AlertItem[] = []

  const decisions = db
    .prepare(
      `SELECT d.*, f.id AS fid, f.slug, w.name AS workspace
         FROM decisions d
         LEFT JOIN requests f ON f.id = d.request_id
         LEFT JOIN workspaces w ON w.id = f.workspace_id
        WHERE d.resolved_at IS NULL
        ORDER BY d.at ASC`
    )
    .all()
  for (const decision of decisions) {
    const request = {
      id: decision.fid ?? 0,
      slug: decision.slug ?? 'workspace',
      workspace: decision.workspace ?? 'workspace',
    }
    const details = [
      decision.question,
      decision.recommendation ? `recommend: ${decision.recommendation}` : '',
      decision.evidence ? `evidence: ${decision.evidence}` : '',
      `default if silent: ${decision.default_if_silent}`,
    ].filter(Boolean)
    items.push({
      key: `decision:${decision.id}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'decision',
      title: decision.fid ? `${label(request)} · ${decision.kind}` : `workspace · ${decision.kind}`,
      body: details.join('\n'),
    })
  }

  const stalled = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'running' AND f.stalled_at IS NOT NULL
        ORDER BY f.stalled_at ASC`
    )
    .all()
  for (const request of stalled) {
    items.push({
      key: `stalled:${request.id}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'stalled',
      title: `${label(request)} · stalled`,
      body:
        `No ledger event since ${request.last_event_at}.` +
        (request.blocked_on ? `\nLast blocker: ${request.blocked_on}` : ''),
    })
  }

  const overBudget = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.soft_budget IS NOT NULL AND f.tokens > f.soft_budget
          AND f.state NOT IN ('completed', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM decisions d
             WHERE d.request_id = f.id AND d.resolved_at IS NULL
          )
        ORDER BY f.tokens DESC`
    )
    .all()
  for (const request of overBudget) {
    items.push({
      key: `budget:${request.id}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'budget',
      title: `${label(request)} · over soft budget`,
      body: `${request.tokens} tokens spent against a soft budget of ${request.soft_budget}.`,
    })
  }

  const approvals = db
    .prepare(
      `SELECT f.*, w.name AS workspace,
              (SELECT COUNT(*) FROM criteria c WHERE c.request_id = f.id) AS total,
              (SELECT COUNT(*) FROM criteria c WHERE c.request_id = f.id AND c.approved_at IS NULL) AS pending
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'draft'
          AND EXISTS (SELECT 1 FROM criteria c WHERE c.request_id = f.id)
        ORDER BY f.id`
    )
    .all()
  for (const request of approvals) {
    if (Number(request.pending) === 0) continue
    items.push({
      key: `approval:${request.id}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'approval',
      title: `${label(request)} · criteria awaiting approval`,
      body: `${request.total} criteria proposed; ${request.pending} still need clara_approve.`,
    })
  }

  const reviews = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'review'
          AND EXISTS (SELECT 1 FROM criteria c WHERE c.request_id = f.id AND c.human_gate = 1)
        ORDER BY f.id`
    )
    .all()
  for (const request of reviews) {
    const unverified = unverifiedGates(db, Number(request.id))
    if (!unverified.length) continue
    items.push({
      key: `review_gate:${request.id}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'review_gate',
      title: `${label(request)} · human gates awaiting verification`,
      body: `Criteria ${unverified.join(', ')} still need clara_gate.`,
    })
  }

  return items
}

/** One-time terminal cancellations deserve a notification but not a permanent inbox row. */
export function recentCancellations(db: Db): AlertItem[] {
  const rows = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'cancelled'
          AND f.cancel_reason IN ('budget', 'attempts', 'time')
          AND f.closed_at IS NOT NULL
        ORDER BY f.closed_at`
    )
    .all()

  const cutoff = Date.now() - 3_600_000
  return rows
    .filter((request) => {
      const closed = Date.parse(String(request.closed_at))
      return Number.isFinite(closed) && closed >= cutoff
    })
    .map((request) => ({
      key: `cancelled:${request.id}:${request.closed_at}`,
      requestId: Number(request.id),
      slug: String(request.slug),
      workspace: String(request.workspace),
      kind: 'cancelled' as const,
      title: `${label(request)} · stopped (${request.cancel_reason})`,
      body: `Clara cancelled this request: ${request.cancel_reason}.`,
      oneTime: true,
    }))
}

/**
 * Insert new exceptions and close rows whose condition cleared. Returns the
 * rows inserted on this pass so the caller can log them.
 */
export function collectAlerts(db: Db): AlertRow[] {
  const pending = pendingHumanWork(db)
  const cancellations = recentCancellations(db)
  const all = [...pending, ...cancellations]
  const at = now()

  const existing = new Map(
    (db.prepare('SELECT key, resolved_at FROM alerts').all() as Row[]).map((row) => [
      String(row.key),
      row.resolved_at ? String(row.resolved_at) : null,
    ])
  )
  const pendingKeys = new Set(pending.map((item) => item.key))
  const inserted: AlertRow[] = []

  db.exec('BEGIN')
  try {
    for (const item of all) {
      const previous = existing.get(item.key)
      if (previous === undefined) {
        const result = db
          .prepare(
            `INSERT INTO alerts
              (key, request_id, slug, workspace, kind, title, body, created_at, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            item.key,
            item.requestId,
            item.slug,
            item.workspace,
            item.kind,
            item.title,
            item.body,
            at,
            item.oneTime ? at : null
          )
        const row = db
          .prepare('SELECT * FROM alerts WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as AlertRow
        inserted.push(row)
        existing.set(item.key, item.oneTime ? at : null)
        continue
      }

      // A gate can be rejected after it was verified, reopening the same key.
      // Clear delivery so the reopened exception reaches Clara again.
      if (!item.oneTime && previous !== null) {
        db.prepare(
          `UPDATE alerts
              SET resolved_at = NULL, session_id = NULL, notified_at = NULL,
                  attention_state = NULL
            WHERE key = ?`
        ).run(item.key)
        existing.set(item.key, null)
      }
    }

    for (const [key, resolved] of existing) {
      if (resolved !== null || pendingKeys.has(key) || key.startsWith('cancelled:')) continue
      db.prepare('UPDATE alerts SET resolved_at = ? WHERE key = ? AND resolved_at IS NULL').run(
        at,
        key
      )
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return inserted
}

function unverifiedGates(db: Db, requestID: number): number[] {
  const gates = db
    .prepare(
      'SELECT position FROM criteria WHERE request_id = ? AND human_gate = 1 ORDER BY position'
    )
    .all(requestID)
    .map((row) => Number(row.position))
  if (!gates.length) return []

  const verified = new Set<number>()
  const records = db
    .prepare("SELECT payload FROM events WHERE request_id = ? AND type = 'human.gates' ORDER BY id")
    .all(requestID)

  for (const record of records) {
    let payload: any
    try {
      payload = JSON.parse(record.payload ?? '{}')
    } catch {
      continue
    }
    const positions = Array.isArray(payload?.criteria) ? payload.criteria.map(Number) : []
    if (payload?.result === 'rejected') {
      for (const position of positions) verified.delete(position)
    } else {
      for (const position of positions) verified.add(position)
    }
  }

  return gates.filter((position) => !verified.has(position))
}
