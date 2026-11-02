// Clara — ledger operations.
//
// Every function here is deterministic. No model calls, no guessing. If the
// ledger cannot answer something, it records a schema gap instead of
// inventing an answer.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pendingHumanWork } from './alerts.ts'
import { ago, now, slugify, type Db, type Row } from './db.ts'
import {
  ensurePipelineSnapshots,
  loadPipeline,
  pipelineHash,
  pipelineSnapshot,
  workspacePipelineId,
} from './pipeline.ts'

export const STALL_MINUTES = 10
export const ATTEMPT_LIMIT = 3

/** Legal state transitions. Anything else is rejected. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['running', 'cancelled'],
  running: ['review', 'cancelled'],
  review: ['completed', 'running', 'cancelled'],
  completed: [],
  cancelled: [],
}

/** Only the supervisor may close a request. An implementer cannot mark its own work done. */
const TERMINAL = new Set(['completed', 'cancelled'])

const pad = (n: number): string => String(n).padStart(3, '0')
const json = (value: unknown): string => JSON.stringify(value ?? null)

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function requestByRef(db: Db, ref: string | number): Row | undefined {
  const key = String(ref).trim()
  if (/^\d+$/.test(key)) {
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(key))
    if (row) return row
  }
  return db.prepare('SELECT * FROM requests WHERE slug = ? ORDER BY id DESC LIMIT 1').get(key)
}

function requireRequest(db: Db, ref: string | number): Row {
  const row = requestByRef(db, ref)
  if (!row) throw new Error(`Clara: no request matching "${ref}"`)
  return row
}

export function workspaceOf(db: Db, request: Row): Row {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(request.workspace_id)!
}

/** Remember which Clara session carries a request's human-facing alerts. */
export function setRequestSession(db: Db, requestID: number, sessionID: string): void {
  db.prepare('UPDATE requests SET session_id = ? WHERE id = ?').run(sessionID, requestID)
}

/** Workspace-level exceptions use the workspace session as a fallback. */
export function setWorkspaceSession(db: Db, workspaceID: number, sessionID: string): void {
  db.prepare('UPDATE workspaces SET session_id = ? WHERE id = ?').run(sessionID, workspaceID)
}

export function ensureWorkspace(db: Db, name: string, path?: string): Row {
  const existing = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(name)
  if (existing) {
    if (path && existing.path !== path) {
      db.prepare('UPDATE workspaces SET path = ? WHERE id = ?').run(path, existing.id)
      existing.path = path
    }
    return existing
  }
  if (!path) throw new Error(`Clara: workspace "${name}" is new — pass its absolute path`)
  db.prepare('INSERT INTO workspaces (name, path, created_at) VALUES (?, ?, ?)').run(
    name,
    path,
    now()
  )
  return db.prepare('SELECT * FROM workspaces WHERE name = ?').get(name)!
}

// ---------------------------------------------------------------------------
// Request records (prose, in the workspace repo)
// ---------------------------------------------------------------------------

function recordPath(request: Row): string | null {
  return request.record_path ?? null
}

function writeInitialRecord(request: Row, meta: Row): void {
  const path = recordPath(request)
  if (!path) return
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) return

  const list = (items: string[] | undefined, fallback: string): string =>
    items && items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${fallback}`

  writeFileSync(
    path,
    `---
request: ${request.id}
slug: ${request.slug}
workspace: ${meta.workspace}
pipeline: ${request.pipeline_id ?? 'software'}@${request.pipeline_version ?? 1}
state: ${request.state}
created: ${request.created_at}
---

# ${pad(request.id)} — ${request.title}

## Intent

${request.intent}

## Why

${meta.why || '_not stated_'}

## Non-goals

${list(meta.non_goals, '_none declared — this is a gap_')}

## Constraints

${list(meta.constraints, '_none declared_')}

## Not worth it if

${meta.not_worth_it || '_not stated_'}

## Budget

soft: ${request.soft_budget ?? '_unset_'} · hard: ${request.hard_budget ?? '_unset_'}

## Checkpoints

_None yet._
`,
    'utf8'
  )
}

function appendRecord(request: Row, text: string): void {
  const path = recordPath(request)
  if (!path || !existsSync(path)) return
  appendFileSync(path, text, 'utf8')
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface SubmitInput {
  workspace: string
  path?: string
  title: string
  intent: string
  why?: string
  non_goals?: string[]
  constraints?: string[]
  priority?: 'now' | 'next' | 'whenever'
  not_worth_it?: string
  soft_budget?: number
  hard_budget?: number
  time_limit_minutes?: number
  /** Pipeline id. Defaults to the workspace pipeline, then `software`. */
  pipeline?: string
  /** The Clara session where the human submitted this request. */
  session_id?: string
}

export function submit(db: Db, input: SubmitInput): string {
  ensurePipelineSnapshots(db)
  const ws = ensureWorkspace(db, input.workspace, input.path)
  const loaded = loadPipeline(input.pipeline?.trim() || workspacePipelineId(ws))
  const contract = loaded.pipeline.stages.find((stage) => stage.phase === 'contract')
  if (!contract) throw new Error(`Clara: pipeline ${loaded.pipeline.id} has no contract stage`)

  const base = slugify(input.title) || 'request'
  let slug = base
  let suffix = 2
  while (
    db.prepare('SELECT 1 FROM requests WHERE workspace_id = ? AND slug = ?').get(ws.id, slug)
  ) {
    slug = `${base}-${suffix++}`
  }

  const at = now()
  const meta = {
    workspace: ws.name,
    why: input.why ?? null,
    non_goals: input.non_goals ?? [],
    constraints: input.constraints ?? [],
    priority: input.priority ?? 'next',
    not_worth_it: input.not_worth_it ?? null,
  }

  const result = db
    .prepare(
      `INSERT INTO requests
        (workspace_id, slug, title, intent, meta, state, soft_budget, hard_budget,
         time_limit_minutes, session_id, last_event_at, created_at,
         pipeline_id, pipeline_version, pipeline_hash, pipeline_snapshot,
         current_stage_id)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ws.id,
      slug,
      input.title,
      input.intent,
      json(meta),
      input.soft_budget ?? null,
      input.hard_budget ?? null,
      input.time_limit_minutes ?? null,
      input.session_id ?? null,
      at,
      at,
      loaded.pipeline.id,
      loaded.pipeline.version,
      pipelineHash(loaded.pipeline),
      pipelineSnapshot(loaded.pipeline),
      contract.id
    )

  if (input.session_id) {
    db.prepare('UPDATE workspaces SET session_id = ? WHERE id = ? AND session_id IS NULL').run(
      input.session_id,
      ws.id
    )
  }

  const id = Number(result.lastInsertRowid)
  const recordPath = join(ws.path, 'docs', 'records', `${pad(id)}-${slug}.md`)
  db.prepare('UPDATE requests SET record_path = ? WHERE id = ?').run(recordPath, id)

  const request = requireRequest(db, id)
  writeInitialRecord(request, meta)

  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    at,
    'request.submitted',
    'human',
    json({
      priority: meta.priority,
      session: input.session_id ?? null,
      pipeline: `${loaded.pipeline.id}@${loaded.pipeline.version}`,
    })
  )

  return [
    `submitted ${pad(id)} ${slug} [${ws.name}] state=draft`,
    `pipeline: ${loaded.pipeline.id}@${loaded.pipeline.version} (${loaded.pipeline.name})`,
    `record: ${existsSync(recordPath) ? recordPath : `${recordPath} (workspace path missing — record not written)`}`,
    `next: the contract stage proposes acceptance criteria; a human approves before work starts.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// criteria + approval + freeze
// ---------------------------------------------------------------------------

export interface CriterionInput {
  text: string
  test_path?: string
  human_gate?: boolean
}

export function setCriteria(
  db: Db,
  input: {
    request: string | number
    criteria: CriterionInput[]
    kill_criteria?: string[]
    docs_impact?: string
  }
): string {
  const request = requireRequest(db, input.request)
  if (request.state !== 'draft') {
    throw new Error(
      `Clara: criteria can only be proposed in state=draft (request ${pad(request.id)} is ${request.state})`
    )
  }
  if (!input.criteria.length) throw new Error('Clara: at least one criterion is required')

  const unresolved = input.criteria.filter((c) => !c.test_path && !c.human_gate)
  if (unresolved.length) {
    throw new Error(
      `Clara: ${unresolved.length} criteria have neither a test_path nor human_gate: ` +
        unresolved.map((c) => `"${c.text}"`).join(', ')
    )
  }

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM criteria WHERE request_id = ?').run(request.id)
    const insert = db.prepare(
      'INSERT INTO criteria (request_id, position, text, test_path, human_gate) VALUES (?, ?, ?, ?, ?)'
    )
    input.criteria.forEach((c, i) => {
      insert.run(request.id, i + 1, c.text, c.test_path ?? null, c.human_gate ? 1 : 0)
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const at = now()
  const sets = ['last_event_at = ?']
  const values: any[] = [at]
  if (input.docs_impact !== undefined) {
    sets.push('docs_impact = ?')
    values.push(input.docs_impact)
  }
  values.push(request.id)
  db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    request.id,
    at,
    'criteria.proposed',
    'ai_1',
    json({
      count: input.criteria.length,
      kill_criteria: input.kill_criteria ?? [],
      docs_impact: input.docs_impact ?? null,
    })
  )

  const table = [
    '',
    '## Acceptance criteria',
    '',
    '| # | Criterion | Test | Human gate |',
    '|---|---|---|---|',
    ...input.criteria.map(
      (c, i) => `| ${i + 1} | ${c.text} | ${c.test_path ?? '—'} | ${c.human_gate ? 'yes' : 'no'} |`
    ),
    '',
  ].join('\n')

  appendRecord(request, table)

  appendRecord(
    request,
    `\n## Docs impact\n\n${String(input.docs_impact ?? 'none').trim() || 'none'}\n`
  )

  if (input.kill_criteria?.length) {
    appendRecord(
      request,
      `\n## Kill criteria\n\n${input.kill_criteria.map((k) => `- ${k}`).join('\n')}\n`
    )
  }

  return [
    `${pad(request.id)} ${request.slug}: ${input.criteria.length} criteria proposed`,
    `${input.criteria.filter((c) => c.human_gate).length} human gate(s)`,
    `awaiting human approval — nothing proceeds until clara_approve.`,
  ].join('\n')
}

export function approve(db: Db, input: { request: string | number; approved_by?: string }): string {
  const request = requireRequest(db, input.request)
  const criteria = db.prepare('SELECT * FROM criteria WHERE request_id = ?').all(request.id)
  if (!criteria.length) throw new Error('Clara: no criteria to approve')
  if (request.state !== 'draft') {
    throw new Error(`Clara: approval is only valid in state=draft (request is ${request.state})`)
  }

  const at = now()
  db.prepare(
    'UPDATE criteria SET approved_at = ? WHERE request_id = ? AND approved_at IS NULL'
  ).run(at, request.id)
  db.prepare("UPDATE requests SET state = 'approved', last_event_at = ? WHERE id = ?").run(
    at,
    request.id
  )
  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    request.id,
    at,
    'criteria.approved',
    'human',
    json({ by: input.approved_by ?? 'human', count: criteria.length })
  )

  return `${pad(request.id)} ${request.slug}: criteria approved → state=approved. Work may now start.`
}

export function freeze(
  db: Db,
  input: { request: string | number; tests_hash: string; tests_total?: number }
): string {
  const request = requireRequest(db, input.request)
  if (request.state !== 'approved') {
    throw new Error(`Clara: tests freeze in state=approved (request is ${request.state})`)
  }
  const at = now()
  db.prepare('UPDATE requests SET tests_hash = ?, last_event_at = ? WHERE id = ?').run(
    input.tests_hash,
    at,
    request.id
  )
  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    request.id,
    at,
    'tests.frozen',
    'ai_2',
    json({ hash: input.tests_hash, total: input.tests_total ?? null })
  )
  return `${pad(request.id)} ${request.slug}: tests frozen at ${input.tests_hash.slice(0, 12)}… — these files may not change from here.`
}

// ---------------------------------------------------------------------------
// events + checkpoints
// ---------------------------------------------------------------------------

export function appendEvent(
  db: Db,
  input: {
    request: string | number
    type: string
    actor: string
    payload?: unknown
    state?: string
  }
): string {
  const request = requireRequest(db, input.request)
  const at = now()
  const previousState = String(request.state)

  if (input.state) {
    const allowed = TRANSITIONS[request.state] ?? []
    if (!allowed.includes(input.state)) {
      throw new Error(
        `Clara: illegal transition ${request.state} → ${input.state} (allowed: ${allowed.join(', ') || 'none'})`
      )
    }
    if (TERMINAL.has(input.state) && input.actor !== 'ai_0') {
      throw new Error(`Clara: only ai_0 may move a request to ${input.state}`)
    }
  }

  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(request.id, at, input.type, input.actor, json(input.payload))

    const sets = ['last_event_at = ?', 'stalled_at = NULL']
    const values: any[] = [at]

    if (input.state) {
      sets.push('state = ?')
      values.push(input.state)
      if (input.state === 'running' && !request.started_at) {
        sets.push('started_at = ?')
        values.push(at)
      }
      // Review or closure invalidates any blocker left by the build stage.
      if (input.state === 'review' || TERMINAL.has(input.state)) {
        sets.push('blocked_on = NULL')
      }
      if (TERMINAL.has(input.state)) {
        sets.push('closed_at = ?')
        values.push(at)
      }
    }

    if (input.type === 'ci.failed') {
      sets.push('attempts = attempts + 1')
    }

    values.push(request.id)
    db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const updated = requireRequest(db, request.id)
  if (input.state) {
    appendRecord(
      request,
      `\n- **${at}** state ${previousState} → ${input.state} (${input.actor})` +
        (updated.cancel_reason ? ` · ${updated.cancel_reason}` : '') +
        `\n`
    )
  }
  return `${pad(updated.id)} ${updated.slug}: ${input.type} by ${input.actor}${input.state ? ` → state=${updated.state}` : ''}`
}

export interface CheckpointInput {
  request: string | number
  tests_passed: number
  tests_total: number
  files_changed?: number
  criteria_addressed?: number[]
  blocked_on?: string
  next?: string
  open_question?: string
  tokens?: number
  docs_impact?: string
}

export function checkpoint(db: Db, input: CheckpointInput): string {
  const request = requireRequest(db, input.request)
  if (request.state !== 'running') {
    throw new Error(`Clara: checkpoints belong to state=running (request is ${request.state})`)
  }

  const last = db
    .prepare('SELECT n FROM checkpoints WHERE request_id = ? ORDER BY n DESC LIMIT 1')
    .get(request.id)
  const n = Number(last?.n ?? 0) + 1
  const at = now()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO checkpoints
        (request_id, n, at, tests_passed, tests_total, files_changed,
         criteria_addressed, blocked_on, next_step, open_question, tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      request.id,
      n,
      at,
      input.tests_passed,
      input.tests_total,
      input.files_changed ?? 0,
      json(input.criteria_addressed ?? []),
      input.blocked_on ?? null,
      input.next ?? null,
      input.open_question ?? null,
      input.tokens ?? null
    )

    const sets = ['last_event_at = ?', 'stalled_at = NULL']
    const values: any[] = [at]
    if (typeof input.tokens === 'number') {
      sets.push('tokens = tokens + ?')
      values.push(input.tokens)
    }
    // A checkpoint without a blocker clears the previous one. The column is
    // current state, not a log; the checkpoints table keeps the history.
    sets.push('blocked_on = ?')
    values.push(input.blocked_on ?? null)
    if (input.docs_impact !== undefined) {
      sets.push('docs_impact = ?')
      values.push(input.docs_impact)
    }
    values.push(request.id)
    db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    db.prepare(
      'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(
      request.id,
      at,
      'checkpoint',
      'ai_3',
      json({
        n,
        tests: `${input.tests_passed}/${input.tests_total}`,
        blocked_on: input.blocked_on ?? null,
      })
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  appendRecord(
    request,
    `\n- **#${n}** ${at} — tests ${input.tests_passed}/${input.tests_total}, ` +
      `${input.files_changed ?? 0} files` +
      (input.blocked_on ? `, blocked: ${input.blocked_on}` : '') +
      (input.next ? `, next: ${input.next}` : '') +
      `\n`
  )

  return `${pad(request.id)} ${request.slug}: checkpoint #${n} — ${input.tests_passed}/${input.tests_total} tests`
}

// ---------------------------------------------------------------------------
// decisions (the inbox)
// ---------------------------------------------------------------------------

export function decide(
  db: Db,
  input: {
    request?: string | number
    kind: 'decision' | 'blocked' | 'failed' | 'done'
    question: string
    recommendation?: string
    evidence?: string
    reversible?: boolean
    cost?: string
    default_if_silent?: string
  }
): string {
  const request = input.request ? requireRequest(db, input.request) : undefined
  const at = now()

  const result = db
    .prepare(
      `INSERT INTO decisions
        (request_id, at, kind, question, recommendation, evidence, reversible, cost, default_if_silent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      request?.id ?? null,
      at,
      input.kind,
      input.question,
      input.recommendation ?? null,
      input.evidence ?? null,
      input.reversible === false ? 0 : 1,
      input.cost ?? null,
      input.default_if_silent ?? 'block'
    )

  const id = Number(result.lastInsertRowid)

  if (request) {
    db.prepare('UPDATE requests SET last_event_at = ? WHERE id = ?').run(at, request.id)
    db.prepare(
      'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(request.id, at, 'decision.opened', 'ai_0', json({ decision: id, kind: input.kind }))
  }

  return `decision #${id} opened${request ? ` for ${pad(request.id)} ${request.slug}` : ''} — ${input.kind}: ${input.question}`
}

export function resolveDecision(
  db: Db,
  input: { id: number; resolution: string; resolved_by?: string }
): string {
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(input.id)
  if (!row) throw new Error(`Clara: no decision #${input.id}`)
  if (row.resolved_at) return `decision #${input.id} already resolved at ${row.resolved_at}`

  const at = now()
  db.prepare('UPDATE decisions SET resolved_at = ?, resolution = ? WHERE id = ?').run(
    at,
    `${input.resolution} (by ${input.resolved_by ?? 'human'})`,
    input.id
  )

  if (row.request_id) {
    // The human acted on the blocker, so the displayed one is stale even when
    // the stage is about to retry and fail again.
    db.prepare('UPDATE requests SET blocked_on = NULL, last_event_at = ? WHERE id = ?').run(
      at,
      row.request_id
    )
    db.prepare(
      'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(
      row.request_id,
      at,
      'decision.resolved',
      'human',
      json({ decision: input.id, resolution: input.resolution })
    )
  }

  return `decision #${input.id} resolved: ${input.resolution}`
}

// ---------------------------------------------------------------------------
// human gates
// ---------------------------------------------------------------------------

export interface GateInput {
  request: string | number
  criteria?: number[]
  evidence?: string
  result?: 'verified' | 'rejected'
}

/**
 * Record that a human verified (or rejected) the human-gate criteria. The
 * judge uses this event to decide whether it may close; it cannot verify a
 * human gate itself.
 */
export function gate(db: Db, input: GateInput): string {
  const request = requireRequest(db, input.request)
  if (request.state !== 'review') {
    throw new Error(
      `Clara: human gates confirm in state=review (request ${pad(request.id)} is ${request.state})`
    )
  }

  const gatePositions = db
    .prepare(
      'SELECT position FROM criteria WHERE request_id = ? AND human_gate = 1 ORDER BY position'
    )
    .all(request.id)
    .map((row) => Number(row.position))
  if (!gatePositions.length) {
    throw new Error(`Clara: request ${pad(request.id)} has no human-gate criteria`)
  }

  const positions = (input.criteria?.length ? input.criteria : gatePositions).map(Number)
  const unknown = positions.filter((position) => !gatePositions.includes(position))
  if (unknown.length) {
    throw new Error(
      `Clara: criteria ${unknown.join(', ')} are not human gates for request ${pad(request.id)} ` +
        `(gates: ${gatePositions.join(', ')})`
    )
  }

  const at = now()
  const result = input.result === 'rejected' ? 'rejected' : 'verified'
  db.prepare(
    'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    request.id,
    at,
    'human.gates',
    'human',
    json({ criteria: positions, result, evidence: input.evidence ?? null })
  )
  db.prepare(
    'UPDATE requests SET last_event_at = ?, stalled_at = NULL, blocked_on = NULL WHERE id = ?'
  ).run(at, request.id)

  return (
    `${pad(request.id)} ${request.slug}: human gates ${result} — ${positions.join(', ')}` +
    (input.evidence ? ` (${input.evidence})` : '')
  )
}

// ---------------------------------------------------------------------------
// inbox
// ---------------------------------------------------------------------------

export function inbox(db: Db, input: { workspace?: string } = {}): string {
  const ws = input.workspace
    ? db.prepare('SELECT * FROM workspaces WHERE name = ?').get(input.workspace)
    : undefined
  if (input.workspace && !ws) throw new Error(`Clara: no workspace "${input.workspace}"`)

  const decisions = db
    .prepare(
      `SELECT d.*, f.slug, f.id AS fid, w.name AS workspace
         FROM decisions d
         LEFT JOIN requests f ON f.id = d.request_id
         LEFT JOIN workspaces w ON w.id = f.workspace_id
        WHERE d.resolved_at IS NULL
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY d.at ASC`
    )
    .all(...(ws ? [ws.id] : []))

  const stalled = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'running' AND f.stalled_at IS NOT NULL
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.stalled_at ASC`
    )
    .all(...(ws ? [ws.id] : []))

  const over = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM requests f JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.soft_budget IS NOT NULL AND f.tokens > f.soft_budget
          AND f.state NOT IN ('completed', 'cancelled')
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.tokens DESC`
    )
    .all(...(ws ? [ws.id] : []))

  const waits = pendingHumanWork(db).filter(
    (item) =>
      (item.kind === 'approval' || item.kind === 'review_gate' || item.kind === 'stage_gate') &&
      (!input.workspace || item.workspace === input.workspace)
  )

  if (!decisions.length && !stalled.length && !over.length && !waits.length) {
    return 'inbox: empty. Nothing needs you.'
  }

  const lines: string[] = []

  for (const d of decisions) {
    const head = d.fid ? `${pad(Number(d.fid))} ${d.slug} [${d.workspace}]` : 'workspace'
    lines.push(`${head} · ${d.kind}`)
    lines.push(`   needs: ${d.question}`)
    if (d.recommendation) lines.push(`   recommend: ${d.recommendation}`)
    if (d.evidence) lines.push(`   evidence: ${d.evidence}`)
    lines.push(`   reversible: ${d.reversible ? 'yes' : 'no'}${d.cost ? ` · cost: ${d.cost}` : ''}`)
    lines.push(`   default if silent: ${d.default_if_silent}`)
    lines.push(`   (#${d.id}, open ${ago(d.at)})`)
    lines.push('')
  }

  for (const f of stalled) {
    lines.push(`${pad(Number(f.id))} ${f.slug} [${f.workspace}] · stalled`)
    lines.push(`   no event since ${ago(f.last_event_at)}`)
    if (f.blocked_on) lines.push(`   last blocked on: ${f.blocked_on}`)
    lines.push('')
  }

  for (const f of over) {
    lines.push(`${pad(Number(f.id))} ${f.slug} [${f.workspace}] · over soft budget`)
    lines.push(`   ${f.tokens} tokens vs soft ${f.soft_budget} · state=${f.state}`)
    lines.push('')
  }

  for (const item of waits) {
    lines.push(item.title)
    for (const line of item.body.split('\n')) lines.push(`   ${line}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

export function ask(
  db: Db,
  input: { question?: string; request?: string | number; workspace?: string; limit?: number }
): string {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
  const question = input.question ?? 'unanswerable ledger query'

  if (input.request !== undefined) {
    const request = requestByRef(db, input.request)
    if (!request) {
      recordGap(db, question, `no request matching "${input.request}"`)
      return `The ledger has no request matching "${input.request}". Gap recorded.`
    }
    return renderRequest(db, request)
  }

  let rows: Row[]
  if (input.workspace) {
    const ws = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(input.workspace)
    if (!ws) {
      recordGap(db, question, `no workspace "${input.workspace}"`)
      return `The ledger has no workspace "${input.workspace}". Gap recorded.`
    }
    rows = db
      .prepare(
        `SELECT f.*, w.name AS workspace FROM requests f
           JOIN workspaces w ON w.id = f.workspace_id
          WHERE f.workspace_id = ?
          ORDER BY f.state = 'completed', f.id DESC LIMIT ?`
      )
      .all(ws.id, limit)
  } else {
    rows = db
      .prepare(
        `SELECT f.*, w.name AS workspace FROM requests f
           JOIN workspaces w ON w.id = f.workspace_id
          ORDER BY f.state IN ('completed', 'cancelled'), f.id DESC LIMIT ?`
      )
      .all(limit)
  }

  if (!rows.length) {
    recordGap(db, question, 'no requests in ledger')
    return 'The ledger is empty. Gap recorded — nothing has been submitted yet.'
  }

  const lines = rows.map((f) => summaryLine(db, f))
  return [`${rows.length} request(s):`, '', ...lines].join('\n')
}

function summaryLine(db: Db, f: Row): string {
  const ws = f.workspace ?? workspaceOf(db, f).name
  const open = db
    .prepare('SELECT COUNT(*) AS c FROM decisions WHERE request_id = ? AND resolved_at IS NULL')
    .get(f.id)
  const cp = db
    .prepare(
      'SELECT tests_passed, tests_total FROM checkpoints WHERE request_id = ? ORDER BY n DESC LIMIT 1'
    )
    .get(f.id)
  const openCount = Number(open?.c ?? 0)

  const parts = [
    `${pad(Number(f.id))} ${f.slug}`,
    `[${ws}]`,
    f.state,
    `${f.tokens} tok`,
    cp ? `${cp.tests_passed}/${cp.tests_total} tests` : 'no checkpoints',
    `last event ${ago(f.last_event_at)}`,
  ]
  if (openCount > 0) parts.push(`${openCount} open decision(s)`)
  if (f.blocked_on) parts.push(`blocked: ${f.blocked_on}`)
  if (f.cancel_reason) parts.push(`cancelled: ${f.cancel_reason}`)
  return parts.join(' · ')
}

interface GateStatus {
  gates: number[]
  verified: number[]
  unverified: number[]
  at: string | null
}

/** A later rejection removes a position; verification accumulates. */
function gateStatus(db: Db, requestID: number, criteria: Row[]): GateStatus {
  const gates = criteria.filter((c) => c.human_gate).map((c) => Number(c.position))
  const verified = new Set<number>()
  let at: string | null = null

  const records = db
    .prepare(
      "SELECT at, payload FROM events WHERE request_id = ? AND type = 'human.gates' ORDER BY id"
    )
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
    at = String(record.at)
  }

  return {
    gates,
    verified: gates.filter((position) => verified.has(position)),
    unverified: gates.filter((position) => !verified.has(position)),
    at,
  }
}

function listPositions(positions: number[]): string {
  if (
    positions.length > 1 &&
    positions.every((position, index) => index === 0 || position === positions[index - 1] + 1)
  ) {
    return `${positions[0]}–${positions[positions.length - 1]}`
  }
  return positions.join(', ')
}

function eventDetail(row: Row): string {
  let payload: any
  try {
    payload = JSON.parse(row.payload ?? '{}')
  } catch {
    return ''
  }
  if (!payload || typeof payload !== 'object') return ''

  switch (row.type) {
    case 'stage.started':
    case 'stage.done':
    case 'stage.failed':
    case 'ci.failed':
      return payload.stage ? ` (${payload.stage})` : ''
    case 'tests.frozen':
      return payload.hash ? ` (${String(payload.hash).slice(0, 12)}…)` : ''
    case 'build.review':
      return payload.tests ? ` (${payload.tests})` : ''
    case 'checkpoint':
      return ` (#${payload.n ?? '?'} ${payload.tests ?? ''})`.trimEnd()
    case 'decision.opened':
      return ` (#${payload.decision ?? '?'}${payload.kind ? ` ${payload.kind}` : ''})`
    case 'decision.resolved':
      return ` (#${payload.decision ?? '?'})`
    case 'human.gates':
      return ` (${listPositions(
        Array.isArray(payload.criteria) ? payload.criteria.map(Number) : []
      )} ${payload.result ?? ''})`
    case 'criteria.proposed':
    case 'criteria.approved':
      return payload.count !== undefined ? ` (${payload.count})` : ''
    default:
      return ''
  }
}

function renderRequest(db: Db, f: Row): string {
  const ws = workspaceOf(db, f)
  const criteria = db
    .prepare('SELECT * FROM criteria WHERE request_id = ? ORDER BY position')
    .all(f.id)
  const checkpoints = db
    .prepare('SELECT * FROM checkpoints WHERE request_id = ? ORDER BY n DESC LIMIT 5')
    .all(f.id)
  const events = db
    .prepare('SELECT * FROM events WHERE request_id = ? ORDER BY id DESC LIMIT 10')
    .all(f.id)
  const decisions = db
    .prepare('SELECT * FROM decisions WHERE request_id = ? ORDER BY id DESC LIMIT 5')
    .all(f.id)
  const runs = db
    .prepare(
      `SELECT stage, agent, status, session_id, note FROM runs
        WHERE request_id = ? ORDER BY id DESC LIMIT 6`
    )
    .all(f.id)

  const meta = f.meta ? JSON.parse(f.meta) : {}
  const approved = criteria.filter((c) => c.approved_at).length
  const gates = gateStatus(db, Number(f.id), criteria)

  const frozen = db
    .prepare(
      "SELECT payload FROM events WHERE request_id = ? AND type = 'tests.frozen' ORDER BY id DESC LIMIT 1"
    )
    .get(f.id)
  let frozenTotal: number | null = null
  if (frozen) {
    try {
      const payload = JSON.parse(frozen.payload ?? '{}')
      frozenTotal = typeof payload?.total === 'number' ? payload.total : null
    } catch {
      frozenTotal = null
    }
  }

  const impact = String(f.docs_impact ?? '').trim()
  const docsNeeded = impact !== '' && !['none', 'n/a', 'no'].includes(impact.toLowerCase())
  const docsRun = db
    .prepare(
      "SELECT status FROM runs WHERE request_id = ? AND stage = 'docs' ORDER BY id DESC LIMIT 1"
    )
    .get(f.id)
  const docsState = !docsNeeded
    ? 'none'
    : docsRun?.status === 'done'
      ? `applied (${impact})`
      : `pending (${impact})`

  const human =
    gates.gates.length === 0
      ? 'no gates'
      : gates.unverified.length === 0
        ? `verified ${listPositions(gates.verified)}${gates.at ? ` at ${gates.at}` : ''}`
        : `UNVERIFIED (${listPositions(gates.unverified)})` +
          (gates.verified.length ? ` · verified ${listPositions(gates.verified)}` : '')

  const lines: string[] = [
    `${pad(Number(f.id))} ${f.slug} [${ws.name}]`,
    `state:     ${f.state}`,
    `intent:    ${f.intent}`,
    `record:    ${
      f.record_path
        ? `${f.record_path} (frontmatter is historical; this row is authoritative)`
        : '—'
    }`,
    `branch:    ${f.branch ?? '—'}   worktree: ${f.worktree ?? '—'}`,
    `cost:      ${f.tokens} tokens${f.usd ? ` · $${f.usd}` : ''}` +
      (f.soft_budget ? ` · soft ${f.soft_budget}` : '') +
      (f.hard_budget ? ` · hard ${f.hard_budget}` : ''),
    `attempts:  ${f.attempts}${f.attempts > ATTEMPT_LIMIT ? ' (over limit)' : ''}`,
    `tests:     ${
      f.tests_hash
        ? `${f.tests_hash}${frozenTotal !== null ? ` (${frozenTotal} tests)` : ''}`
        : 'not frozen'
    }`,
    `docs:      ${docsState}`,
    `human:     ${human}`,
    `last:      ${f.last_event_at} (${ago(f.last_event_at)})`,
  ]

  if (f.stalled_at) lines.push(`stalled:   since ${f.stalled_at}`)
  if (f.blocked_on) lines.push(`blocked:   ${f.blocked_on}`)
  if (f.cancel_reason) lines.push(`cancelled:  ${f.cancel_reason}`)
  if (meta.non_goals?.length) lines.push(`non-goals: ${meta.non_goals.join('; ')}`)

  lines.push(
    '',
    `criteria:  ${criteria.length ? `${approved}/${criteria.length} approved` : 'none proposed'}`
  )
  for (const c of criteria) {
    const gate = c.human_gate ? 'human gate' : c.test_path
    lines.push(`  ${c.position}. ${c.text} — ${gate}`)
  }

  if (runs.length) {
    lines.push('', 'runs (latest first):')
    for (const r of runs) {
      const note = r.note ? ` — ${String(r.note).slice(0, 90)}` : ''
      lines.push(
        `  ${r.stage} ${r.status} (${r.agent}${r.session_id ? ` ${r.session_id}` : ''})${note}`
      )
    }
  }

  if (checkpoints.length) {
    lines.push('', 'checkpoints (latest first):')
    for (const c of checkpoints) {
      let addressed: number[] = []
      try {
        const parsed = JSON.parse(c.criteria_addressed ?? '[]')
        if (Array.isArray(parsed)) addressed = parsed.map(Number)
      } catch {
        addressed = []
      }
      lines.push(
        `  #${c.n} ${c.at} — ${c.tests_passed}/${c.tests_total} tests, ${c.files_changed} files` +
          (addressed.length ? `, criteria ${listPositions(addressed)}` : '') +
          (c.blocked_on ? `, blocked: ${c.blocked_on}` : '') +
          (c.next_step ? `, next at the time: ${c.next_step}` : '')
      )
    }
  }

  if (decisions.length) {
    lines.push('', 'decisions:')
    for (const d of decisions) {
      lines.push(
        `  #${d.id} ${d.kind} — ${d.question} [${d.resolved_at ? `resolved: ${d.resolution}` : 'OPEN'}]`
      )
    }
  }

  if (events.length) {
    lines.push('', 'recent events:')
    for (const e of events) lines.push(`  ${e.at} ${e.type}${eventDetail(e)} (${e.actor})`)
  }

  return lines.join('\n')
}

function recordGap(db: Db, question: string, note: string): void {
  db.prepare('INSERT INTO schema_gaps (at, question, note) VALUES (?, ?, ?)').run(
    now(),
    question,
    note
  )
}

// ---------------------------------------------------------------------------
// tick — the deterministic half of the supervisor. No model calls.
// ---------------------------------------------------------------------------

export function tick(db: Db, input: { workspace?: string; dry_run?: boolean } = {}): string {
  const dry = input.dry_run !== false
  const ws = input.workspace
    ? db.prepare('SELECT * FROM workspaces WHERE name = ?').get(input.workspace)
    : undefined
  if (input.workspace && !ws) throw new Error(`Clara: no workspace "${input.workspace}"`)

  const active = db
    .prepare(
      `SELECT f.*, w.name AS workspace FROM requests f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state IN ('approved', 'running', 'review')
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.id`
    )
    .all(...(ws ? [ws.id] : []))

  const actions: string[] = []
  const at = now()

  const kill = (f: Row, reason: string) => {
    if (dry) {
      actions.push(`${pad(f.id)} ${f.slug}: WOULD cancel (${reason})`)
      return
    }
    db.prepare(
      "UPDATE requests SET state = 'cancelled', cancel_reason = ?, closed_at = ?, last_event_at = ? WHERE id = ?"
    ).run(reason, at, at, f.id)
    db.prepare(
      'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(f.id, at, 'request.cancelled', 'ai_0', json({ reason }))
    appendRecord(f, `\n- **${at}** state ${f.state} → cancelled (ai_0) · ${reason}\n`)
    actions.push(`${pad(f.id)} ${f.slug}: cancelled (${reason})`)
  }

  for (const f of active) {
    const label = `${pad(f.id)} ${f.slug}`

    // Hard budget
    if (f.hard_budget != null && f.tokens > f.hard_budget) {
      kill(f, 'budget')
      continue
    }

    // Attempts
    if (f.attempts > ATTEMPT_LIMIT) {
      kill(f, 'attempts')
      continue
    }

    // Wall clock
    if (f.time_limit_minutes != null && f.started_at) {
      const mins = (Date.now() - new Date(f.started_at).getTime()) / 60_000
      if (mins > f.time_limit_minutes) {
        kill(f, 'time')
        continue
      }
    }

    // Heartbeat
    if (f.state === 'running' && !f.stalled_at) {
      const mins = (Date.now() - new Date(f.last_event_at).getTime()) / 60_000
      if (mins > STALL_MINUTES) {
        if (dry) {
          actions.push(`${label}: WOULD mark stalled (no event in ${Math.round(mins)}m)`)
        } else {
          db.prepare('UPDATE requests SET stalled_at = ? WHERE id = ?').run(at, f.id)
          db.prepare(
            'INSERT INTO events (request_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
          ).run(f.id, at, 'request.stalled', 'ai_0', json({ minutes: Math.round(mins) }))
          actions.push(`${label}: marked stalled (no event in ${Math.round(mins)}m)`)
        }
      }
    }

    // Soft budget → one open decision, not one per tick
    if (f.soft_budget != null && f.tokens > f.soft_budget) {
      const open = db
        .prepare('SELECT 1 FROM decisions WHERE request_id = ? AND resolved_at IS NULL')
        .get(f.id)
      if (!open) {
        if (dry) {
          actions.push(
            `${label}: WOULD open decision (over soft budget ${f.tokens}/${f.soft_budget})`
          )
        } else {
          decide(db, {
            request: f.id,
            kind: 'decision',
            question: `Spend has passed the soft budget (${f.tokens}/${f.soft_budget} tokens). Finish or kill?`,
            recommendation: 'kill',
            evidence: `state=${f.state}, attempts=${f.attempts}`,
            reversible: false,
            cost: `${f.tokens} tokens spent so far`,
            default_if_silent: 'kill at hard budget',
          })
          actions.push(`${label}: opened soft-budget decision`)
        }
      }
    }

    // Flat progress with rising spend
    const cps = db
      .prepare(
        'SELECT n, tests_passed, tests_total, tokens FROM checkpoints WHERE request_id = ? ORDER BY n DESC LIMIT 3'
      )
      .all(f.id)
    if (cps.length === 3) {
      const flat = cps.every((c) => Number(c.tests_passed) === Number(cps[0].tests_passed))
      const rising =
        cps[0].tokens != null &&
        cps[2].tokens != null &&
        Number(cps[0].tokens) > Number(cps[2].tokens)
      if (flat && rising) {
        const open = db
          .prepare('SELECT 1 FROM decisions WHERE request_id = ? AND resolved_at IS NULL')
          .get(f.id)
        if (!open) {
          if (dry) {
            actions.push(`${label}: WOULD open decision (flat progress, rising spend)`)
          } else {
            decide(db, {
              request: f.id,
              kind: 'decision',
              question:
                'Test count has been flat across three checkpoints while spend rose. Is this thrashing?',
              recommendation: 'kill',
              evidence: `tests ${cps[0].tests_passed}/${cps[0].tests_total} across checkpoints ${cps
                .map((c) => c.n)
                .join(', ')}`,
              reversible: false,
              default_if_silent: 'block',
            })
            actions.push(`${label}: opened flat-progress decision`)
          }
        }
      }
    }
  }

  if (!actions.length)
    return `tick (${dry ? 'dry run' : 'live'}): nothing to do across ${active.length} active request(s)`
  return [`tick (${dry ? 'dry run' : 'live'}): ${actions.length} action(s)`, ...actions].join('\n')
}
