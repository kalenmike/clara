// Clara — ledger operations.
//
// Every function here is deterministic. No model calls, no guessing. If the
// ledger cannot answer something, it records a schema gap instead of
// inventing an answer.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ago, now, slugify, type Db, type Row } from './db.ts'

export const STALL_MINUTES = 10
export const ATTEMPT_LIMIT = 3

/** Legal state transitions. Anything else is rejected. */
const TRANSITIONS: Record<string, string[]> = {
  spec: ['planned', 'scrapped'],
  planned: ['building', 'scrapped'],
  building: ['review', 'scrapped'],
  review: ['done', 'building', 'scrapped'],
  done: [],
  scrapped: [],
}

/** Only the supervisor may close a feature. An implementer cannot mark its own work done. */
const CLOSERS = new Set(['done', 'scrapped'])

const pad = (n: number): string => String(n).padStart(3, '0')
const json = (value: unknown): string => JSON.stringify(value ?? null)

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function featureByRef(db: Db, ref: string | number): Row | undefined {
  const key = String(ref).trim()
  if (/^\d+$/.test(key)) {
    const row = db.prepare('SELECT * FROM features WHERE id = ?').get(Number(key))
    if (row) return row
  }
  return db.prepare('SELECT * FROM features WHERE slug = ? ORDER BY id DESC LIMIT 1').get(key)
}

function requireFeature(db: Db, ref: string | number): Row {
  const row = featureByRef(db, ref)
  if (!row) throw new Error(`Clara: no feature matching "${ref}"`)
  return row
}

export function workspaceOf(db: Db, feature: Row): Row {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(feature.workspace_id)!
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
// Feature records (prose, in the workspace repo)
// ---------------------------------------------------------------------------

function recordPath(feature: Row): string | null {
  return feature.spec_path ?? null
}

function writeInitialRecord(feature: Row, meta: Row): void {
  const path = recordPath(feature)
  if (!path) return
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) return

  const list = (items: string[] | undefined, fallback: string): string =>
    items && items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${fallback}`

  writeFileSync(
    path,
    `---
feature: ${feature.id}
slug: ${feature.slug}
workspace: ${meta.workspace}
state: ${feature.state}
created: ${feature.created_at}
---

# ${pad(feature.id)} — ${feature.title}

## Intent

${feature.intent}

## Why

${meta.why || '_not stated_'}

## Non-goals

${list(meta.non_goals, '_none declared — this is a gap_')}

## Constraints

${list(meta.constraints, '_none declared_')}

## Not worth it if

${meta.not_worth_it || '_not stated_'}

## Budget

soft: ${feature.soft_budget ?? '_unset_'} · hard: ${feature.hard_budget ?? '_unset_'}

## Docs impact

none

## Checkpoints

_None yet._
`,
    'utf8'
  )
}

function appendRecord(feature: Row, text: string): void {
  const path = recordPath(feature)
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
}

export function submit(db: Db, input: SubmitInput): string {
  const ws = ensureWorkspace(db, input.workspace, input.path)

  const base = slugify(input.title) || 'feature'
  let slug = base
  let suffix = 2
  while (
    db.prepare('SELECT 1 FROM features WHERE workspace_id = ? AND slug = ?').get(ws.id, slug)
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
      `INSERT INTO features
        (workspace_id, slug, title, intent, meta, state, soft_budget, hard_budget,
         time_limit_minutes, last_event_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'spec', ?, ?, ?, ?, ?)`
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
      at,
      at
    )

  const id = Number(result.lastInsertRowid)
  const specPath = join(ws.path, 'docs', 'features', `${pad(id)}-${slug}.md`)
  db.prepare('UPDATE features SET spec_path = ? WHERE id = ?').run(specPath, id)

  const feature = requireFeature(db, id)
  writeInitialRecord(feature, meta)

  db.prepare(
    'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(id, at, 'feature.registered', 'human', json({ priority: meta.priority }))

  return [
    `registered ${pad(id)} ${slug} [${ws.name}] state=spec`,
    `record: ${existsSync(specPath) ? specPath : `${specPath} (workspace path missing — record not written)`}`,
    `next: spec agent proposes acceptance criteria; human approves before tests are written.`,
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
    feature: string | number
    criteria: CriterionInput[]
    kill_criteria?: string[]
    docs_impact?: string
  }
): string {
  const feature = requireFeature(db, input.feature)
  if (feature.state !== 'spec') {
    throw new Error(
      `Clara: criteria can only be proposed in state=spec (feature ${pad(feature.id)} is ${feature.state})`
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
    db.prepare('DELETE FROM criteria WHERE feature_id = ?').run(feature.id)
    const insert = db.prepare(
      'INSERT INTO criteria (feature_id, position, text, test_path, human_gate) VALUES (?, ?, ?, ?, ?)'
    )
    input.criteria.forEach((c, i) => {
      insert.run(feature.id, i + 1, c.text, c.test_path ?? null, c.human_gate ? 1 : 0)
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
  values.push(feature.id)
  db.prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  db.prepare(
    'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    feature.id,
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

  appendRecord(feature, table)

  if (input.kill_criteria?.length) {
    appendRecord(
      feature,
      `\n## Kill criteria\n\n${input.kill_criteria.map((k) => `- ${k}`).join('\n')}\n`
    )
  }

  return [
    `${pad(feature.id)} ${feature.slug}: ${input.criteria.length} criteria proposed`,
    `${input.criteria.filter((c) => c.human_gate).length} human gate(s)`,
    `awaiting human approval — nothing proceeds until clara_approve.`,
  ].join('\n')
}

export function approve(db: Db, input: { feature: string | number; approved_by?: string }): string {
  const feature = requireFeature(db, input.feature)
  const criteria = db.prepare('SELECT * FROM criteria WHERE feature_id = ?').all(feature.id)
  if (!criteria.length) throw new Error('Clara: no criteria to approve')
  if (feature.state !== 'spec') {
    throw new Error(`Clara: approval is only valid in state=spec (feature is ${feature.state})`)
  }

  const at = now()
  db.prepare(
    'UPDATE criteria SET approved_at = ? WHERE feature_id = ? AND approved_at IS NULL'
  ).run(at, feature.id)
  db.prepare("UPDATE features SET state = 'planned', last_event_at = ? WHERE id = ?").run(
    at,
    feature.id
  )
  db.prepare(
    'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    feature.id,
    at,
    'criteria.approved',
    'human',
    json({ by: input.approved_by ?? 'human', count: criteria.length })
  )

  return `${pad(feature.id)} ${feature.slug}: criteria approved → state=planned. Tests may now be written and frozen.`
}

export function freeze(
  db: Db,
  input: { feature: string | number; tests_hash: string; tests_total?: number }
): string {
  const feature = requireFeature(db, input.feature)
  if (feature.state !== 'planned') {
    throw new Error(`Clara: tests freeze in state=planned (feature is ${feature.state})`)
  }
  const at = now()
  db.prepare('UPDATE features SET tests_hash = ?, last_event_at = ? WHERE id = ?').run(
    input.tests_hash,
    at,
    feature.id
  )
  db.prepare(
    'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(
    feature.id,
    at,
    'tests.frozen',
    'ai_2',
    json({ hash: input.tests_hash, total: input.tests_total ?? null })
  )
  return `${pad(feature.id)} ${feature.slug}: tests frozen at ${input.tests_hash.slice(0, 12)}… — these files may not change from here.`
}

// ---------------------------------------------------------------------------
// events + checkpoints
// ---------------------------------------------------------------------------

export function appendEvent(
  db: Db,
  input: {
    feature: string | number
    type: string
    actor: string
    payload?: unknown
    state?: string
  }
): string {
  const feature = requireFeature(db, input.feature)
  const at = now()

  if (input.state) {
    const allowed = TRANSITIONS[feature.state] ?? []
    if (!allowed.includes(input.state)) {
      throw new Error(
        `Clara: illegal transition ${feature.state} → ${input.state} (allowed: ${allowed.join(', ') || 'none'})`
      )
    }
    if (CLOSERS.has(input.state) && input.actor !== 'ai_0') {
      throw new Error(`Clara: only ai_0 may move a feature to ${input.state}`)
    }
  }

  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(feature.id, at, input.type, input.actor, json(input.payload))

    const sets = ['last_event_at = ?', 'stalled_at = NULL']
    const values: any[] = [at]

    if (input.state) {
      sets.push('state = ?')
      values.push(input.state)
      if (input.state === 'building' && !feature.started_at) {
        sets.push('started_at = ?')
        values.push(at)
      }
      if (CLOSERS.has(input.state)) {
        sets.push('closed_at = ?')
        values.push(at)
      }
    }

    if (input.type === 'ci.failed') {
      sets.push('attempts = attempts + 1')
    }

    values.push(feature.id)
    db.prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const updated = requireFeature(db, feature.id)
  return `${pad(updated.id)} ${updated.slug}: ${input.type} by ${input.actor}${input.state ? ` → state=${updated.state}` : ''}`
}

export interface CheckpointInput {
  feature: string | number
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
  const feature = requireFeature(db, input.feature)
  if (feature.state !== 'building') {
    throw new Error(`Clara: checkpoints belong to state=building (feature is ${feature.state})`)
  }

  const last = db
    .prepare('SELECT n FROM checkpoints WHERE feature_id = ? ORDER BY n DESC LIMIT 1')
    .get(feature.id)
  const n = Number(last?.n ?? 0) + 1
  const at = now()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO checkpoints
        (feature_id, n, at, tests_passed, tests_total, files_changed,
         criteria_addressed, blocked_on, next_step, open_question, tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      feature.id,
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
    if (input.blocked_on) {
      sets.push('blocked_on = ?')
      values.push(input.blocked_on)
    }
    if (input.docs_impact !== undefined) {
      sets.push('docs_impact = ?')
      values.push(input.docs_impact)
    }
    values.push(feature.id)
    db.prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    db.prepare(
      'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(
      feature.id,
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
    feature,
    `\n- **#${n}** ${at} — tests ${input.tests_passed}/${input.tests_total}, ` +
      `${input.files_changed ?? 0} files` +
      (input.blocked_on ? `, blocked: ${input.blocked_on}` : '') +
      (input.next ? `, next: ${input.next}` : '') +
      `\n`
  )

  return `${pad(feature.id)} ${feature.slug}: checkpoint #${n} — ${input.tests_passed}/${input.tests_total} tests`
}

// ---------------------------------------------------------------------------
// decisions (the inbox)
// ---------------------------------------------------------------------------

export function decide(
  db: Db,
  input: {
    feature?: string | number
    kind: 'decision' | 'blocked' | 'failed' | 'done'
    question: string
    recommendation?: string
    evidence?: string
    reversible?: boolean
    cost?: string
    default_if_silent?: string
  }
): string {
  const feature = input.feature ? requireFeature(db, input.feature) : undefined
  const at = now()

  const result = db
    .prepare(
      `INSERT INTO decisions
        (feature_id, at, kind, question, recommendation, evidence, reversible, cost, default_if_silent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      feature?.id ?? null,
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

  if (feature) {
    db.prepare('UPDATE features SET last_event_at = ? WHERE id = ?').run(at, feature.id)
    db.prepare(
      'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(feature.id, at, 'decision.opened', 'ai_0', json({ decision: id, kind: input.kind }))
  }

  return `decision #${id} opened${feature ? ` for ${pad(feature.id)} ${feature.slug}` : ''} — ${input.kind}: ${input.question}`
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

  if (row.feature_id) {
    db.prepare(
      'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(
      row.feature_id,
      at,
      'decision.resolved',
      'human',
      json({ decision: input.id, resolution: input.resolution })
    )
  }

  return `decision #${input.id} resolved: ${input.resolution}`
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
         LEFT JOIN features f ON f.id = d.feature_id
         LEFT JOIN workspaces w ON w.id = f.workspace_id
        WHERE d.resolved_at IS NULL
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY d.at ASC`
    )
    .all(...(ws ? [ws.id] : []))

  const stalled = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state = 'building' AND f.stalled_at IS NOT NULL
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.stalled_at ASC`
    )
    .all(...(ws ? [ws.id] : []))

  const over = db
    .prepare(
      `SELECT f.*, w.name AS workspace
         FROM features f JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.soft_budget IS NOT NULL AND f.tokens > f.soft_budget
          AND f.state NOT IN ('done', 'scrapped')
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.tokens DESC`
    )
    .all(...(ws ? [ws.id] : []))

  if (!decisions.length && !stalled.length && !over.length) {
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

  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

export function ask(
  db: Db,
  input: { question: string; feature?: string | number; workspace?: string; limit?: number }
): string {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)

  if (input.feature !== undefined) {
    const feature = featureByRef(db, input.feature)
    if (!feature) {
      recordGap(db, input.question, `no feature matching "${input.feature}"`)
      return `The ledger has no feature matching "${input.feature}". Gap recorded.`
    }
    return renderFeature(db, feature)
  }

  let rows: Row[]
  if (input.workspace) {
    const ws = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(input.workspace)
    if (!ws) {
      recordGap(db, input.question, `no workspace "${input.workspace}"`)
      return `The ledger has no workspace "${input.workspace}". Gap recorded.`
    }
    rows = db
      .prepare(
        `SELECT f.*, w.name AS workspace FROM features f
           JOIN workspaces w ON w.id = f.workspace_id
          WHERE f.workspace_id = ?
          ORDER BY f.state = 'done', f.id DESC LIMIT ?`
      )
      .all(ws.id, limit)
  } else {
    rows = db
      .prepare(
        `SELECT f.*, w.name AS workspace FROM features f
           JOIN workspaces w ON w.id = f.workspace_id
          ORDER BY f.state IN ('done', 'scrapped'), f.id DESC LIMIT ?`
      )
      .all(limit)
  }

  if (!rows.length) {
    recordGap(db, input.question, 'no features in ledger')
    return 'The ledger is empty. Gap recorded — nothing has been submitted yet.'
  }

  const lines = rows.map((f) => summaryLine(db, f))
  return [`${rows.length} feature(s):`, '', ...lines].join('\n')
}

function summaryLine(db: Db, f: Row): string {
  const ws = f.workspace ?? workspaceOf(db, f).name
  const open = db
    .prepare('SELECT COUNT(*) AS c FROM decisions WHERE feature_id = ? AND resolved_at IS NULL')
    .get(f.id)
  const cp = db
    .prepare(
      'SELECT tests_passed, tests_total FROM checkpoints WHERE feature_id = ? ORDER BY n DESC LIMIT 1'
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
  if (f.scrap_reason) parts.push(`scrapped: ${f.scrap_reason}`)
  return parts.join(' · ')
}

function renderFeature(db: Db, f: Row): string {
  const ws = workspaceOf(db, f)
  const criteria = db
    .prepare('SELECT * FROM criteria WHERE feature_id = ? ORDER BY position')
    .all(f.id)
  const checkpoints = db
    .prepare('SELECT * FROM checkpoints WHERE feature_id = ? ORDER BY n DESC LIMIT 5')
    .all(f.id)
  const events = db
    .prepare('SELECT * FROM events WHERE feature_id = ? ORDER BY id DESC LIMIT 10')
    .all(f.id)
  const decisions = db
    .prepare('SELECT * FROM decisions WHERE feature_id = ? ORDER BY id DESC LIMIT 5')
    .all(f.id)

  const meta = f.meta ? JSON.parse(f.meta) : {}
  const approved = criteria.filter((c) => c.approved_at).length

  const lines: string[] = [
    `${pad(Number(f.id))} ${f.slug} [${ws.name}]`,
    `state:     ${f.state}`,
    `intent:    ${f.intent}`,
    `record:    ${f.spec_path ?? '—'}`,
    `branch:    ${f.branch ?? '—'}   worktree: ${f.worktree ?? '—'}`,
    `cost:      ${f.tokens} tokens${f.usd ? ` · $${f.usd}` : ''}` +
      (f.soft_budget ? ` · soft ${f.soft_budget}` : '') +
      (f.hard_budget ? ` · hard ${f.hard_budget}` : ''),
    `attempts:  ${f.attempts}${f.attempts > ATTEMPT_LIMIT ? ' (over limit)' : ''}`,
    `last:      ${f.last_event_at} (${ago(f.last_event_at)})`,
  ]

  if (f.stalled_at) lines.push(`stalled:   since ${f.stalled_at}`)
  if (f.blocked_on) lines.push(`blocked:   ${f.blocked_on}`)
  if (f.scrap_reason) lines.push(`scrapped:  ${f.scrap_reason}`)
  if (meta.non_goals?.length) lines.push(`non-goals: ${meta.non_goals.join('; ')}`)

  lines.push(
    '',
    `criteria:  ${criteria.length ? `${approved}/${criteria.length} approved` : 'none proposed'}`
  )
  for (const c of criteria) {
    const gate = c.human_gate ? 'human gate' : c.test_path
    lines.push(`  ${c.position}. ${c.text} — ${gate}`)
  }

  if (checkpoints.length) {
    lines.push('', 'checkpoints (latest first):')
    for (const c of checkpoints) {
      lines.push(
        `  #${c.n} ${c.at} — ${c.tests_passed}/${c.tests_total} tests, ${c.files_changed} files` +
          (c.blocked_on ? `, blocked: ${c.blocked_on}` : '') +
          (c.next_step ? `, next: ${c.next_step}` : '')
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
    for (const e of events) lines.push(`  ${e.at} ${e.type} (${e.actor})`)
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
      `SELECT f.*, w.name AS workspace FROM features f
         JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.state IN ('planned', 'building', 'review')
          ${ws ? 'AND f.workspace_id = ?' : ''}
        ORDER BY f.id`
    )
    .all(...(ws ? [ws.id] : []))

  const actions: string[] = []
  const at = now()

  const kill = (f: Row, reason: string) => {
    if (dry) {
      actions.push(`${pad(f.id)} ${f.slug}: WOULD kill (${reason})`)
      return
    }
    db.prepare(
      "UPDATE features SET state = 'scrapped', scrap_reason = ?, closed_at = ?, last_event_at = ? WHERE id = ?"
    ).run(reason, at, at, f.id)
    db.prepare(
      'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(f.id, at, 'feature.killed', 'ai_0', json({ reason }))
    actions.push(`${pad(f.id)} ${f.slug}: killed (${reason})`)
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
    if (f.state === 'building' && !f.stalled_at) {
      const mins = (Date.now() - new Date(f.last_event_at).getTime()) / 60_000
      if (mins > STALL_MINUTES) {
        if (dry) {
          actions.push(`${label}: WOULD mark stalled (no event in ${Math.round(mins)}m)`)
        } else {
          db.prepare('UPDATE features SET stalled_at = ? WHERE id = ?').run(at, f.id)
          db.prepare(
            'INSERT INTO events (feature_id, at, type, actor, payload) VALUES (?, ?, ?, ?, ?)'
          ).run(f.id, at, 'feature.stalled', 'ai_0', json({ minutes: Math.round(mins) }))
          actions.push(`${label}: marked stalled (no event in ${Math.round(mins)}m)`)
        }
      }
    }

    // Soft budget → one open decision, not one per tick
    if (f.soft_budget != null && f.tokens > f.soft_budget) {
      const open = db
        .prepare('SELECT 1 FROM decisions WHERE feature_id = ? AND resolved_at IS NULL')
        .get(f.id)
      if (!open) {
        if (dry) {
          actions.push(
            `${label}: WOULD open decision (over soft budget ${f.tokens}/${f.soft_budget})`
          )
        } else {
          decide(db, {
            feature: f.id,
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
        'SELECT n, tests_passed, tests_total, tokens FROM checkpoints WHERE feature_id = ? ORDER BY n DESC LIMIT 3'
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
          .prepare('SELECT 1 FROM decisions WHERE feature_id = ? AND resolved_at IS NULL')
          .get(f.id)
        if (!open) {
          if (dry) {
            actions.push(`${label}: WOULD open decision (flat progress, rising spend)`)
          } else {
            decide(db, {
              feature: f.id,
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
    return `tick (${dry ? 'dry run' : 'live'}): nothing to do across ${active.length} active feature(s)`
  return [`tick (${dry ? 'dry run' : 'live'}): ${actions.length} action(s)`, ...actions].join('\n')
}
