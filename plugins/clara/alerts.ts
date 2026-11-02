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

export type AlertKind = 'decision' | 'stalled' | 'budget' | 'approval' | 'gates' | 'kill'

export type AlertItem = {
  key: string
  featureId: number
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
  feature_id: number | null
  slug: string | null
  workspace: string | null
  kind: AlertKind
  title: string
  body: string
  created_at: string
  resolved_at: string | null
}

const pad = (n: number): string => String(n).padStart(3, '0')

function label(feature: Row): string {
  const workspace = feature.workspace ? ` [${feature.workspace}]` : ''
  return `${pad(Number(feature.id))} ${feature.slug}${workspace}`
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
         LEFT JOIN features f ON f.id = d.feature_id
         LEFT JOIN workspaces w ON w.id = f.workspace_id
        WHERE d.resolved_at IS NULL
        ORDER BY d.at ASC`
    )
    .all()
  for (const decision of decisions) {
    const feature = {
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
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'decision',
      title: decision.fid ? `${label(feature)} · ${decision.kind}` : `workspace · ${decision.kind}`,
      body: details.join('\n'),
    })
  }

  const stalled = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'building' AND f.stalled_at IS NOT NULL
        ORDER BY f.stalled_at ASC`
    )
    .all()
  for (const feature of stalled) {
    items.push({
      key: `stalled:${feature.id}`,
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'stalled',
      title: `${label(feature)} · stalled`,
      body:
        `No ledger event since ${feature.last_event_at}.` +
        (feature.blocked_on ? `\nLast blocker: ${feature.blocked_on}` : ''),
    })
  }

  const overBudget = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.soft_budget IS NOT NULL AND f.tokens > f.soft_budget
          AND f.state NOT IN ('done', 'scrapped')
          AND NOT EXISTS (
            SELECT 1 FROM decisions d
             WHERE d.feature_id = f.id AND d.resolved_at IS NULL
          )
        ORDER BY f.tokens DESC`
    )
    .all()
  for (const feature of overBudget) {
    items.push({
      key: `budget:${feature.id}`,
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'budget',
      title: `${label(feature)} · over soft budget`,
      body: `${feature.tokens} tokens spent against a soft budget of ${feature.soft_budget}.`,
    })
  }

  const approvals = db
    .prepare(
      `SELECT f.*, w.name AS workspace,
              (SELECT COUNT(*) FROM criteria c WHERE c.feature_id = f.id) AS total,
              (SELECT COUNT(*) FROM criteria c WHERE c.feature_id = f.id AND c.approved_at IS NULL) AS pending
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'spec'
          AND EXISTS (SELECT 1 FROM criteria c WHERE c.feature_id = f.id)
        ORDER BY f.id`
    )
    .all()
  for (const feature of approvals) {
    if (Number(feature.pending) === 0) continue
    items.push({
      key: `approval:${feature.id}`,
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'approval',
      title: `${label(feature)} · criteria awaiting approval`,
      body: `${feature.total} criteria proposed; ${feature.pending} still need clara_approve.`,
    })
  }

  const reviews = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'review'
          AND EXISTS (SELECT 1 FROM criteria c WHERE c.feature_id = f.id AND c.human_gate = 1)
        ORDER BY f.id`
    )
    .all()
  for (const feature of reviews) {
    const unverified = unverifiedGates(db, Number(feature.id))
    if (!unverified.length) continue
    items.push({
      key: `gates:${feature.id}`,
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'gates',
      title: `${label(feature)} · human gates awaiting verification`,
      body: `Criteria ${unverified.join(', ')} still need clara_gate.`,
    })
  }

  return items
}

/** One-time terminal kills deserve a notification but not a permanent inbox row. */
export function recentKills(db: Db): AlertItem[] {
  const rows = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'scrapped'
          AND f.scrap_reason IN ('budget', 'attempts', 'time')
          AND f.closed_at IS NOT NULL
        ORDER BY f.closed_at`
    )
    .all()

  const cutoff = Date.now() - 3_600_000
  return rows
    .filter((feature) => {
      const closed = Date.parse(String(feature.closed_at))
      return Number.isFinite(closed) && closed >= cutoff
    })
    .map((feature) => ({
      key: `kill:${feature.id}:${feature.closed_at}`,
      featureId: Number(feature.id),
      slug: String(feature.slug),
      workspace: String(feature.workspace),
      kind: 'kill' as const,
      title: `${label(feature)} · stopped (${feature.scrap_reason})`,
      body: `Clara killed this feature: ${feature.scrap_reason}.`,
      oneTime: true,
    }))
}

/**
 * Insert new exceptions and close rows whose condition cleared. Returns the
 * rows inserted on this pass so the caller can log them.
 */
export function collectAlerts(db: Db): AlertRow[] {
  const pending = pendingHumanWork(db)
  const kills = recentKills(db)
  const all = [...pending, ...kills]
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
              (key, feature_id, slug, workspace, kind, title, body, created_at, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            item.key,
            item.featureId,
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
      if (resolved !== null || pendingKeys.has(key) || key.startsWith('kill:')) continue
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

function unverifiedGates(db: Db, featureID: number): number[] {
  const gates = db
    .prepare(
      'SELECT position FROM criteria WHERE feature_id = ? AND human_gate = 1 ORDER BY position'
    )
    .all(featureID)
    .map((row) => Number(row.position))
  if (!gates.length) return []

  const verified = new Set<number>()
  const records = db
    .prepare("SELECT payload FROM events WHERE feature_id = ? AND type = 'human.gates' ORDER BY id")
    .all(featureID)

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
