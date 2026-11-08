import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type Row = Record<string, unknown>

export interface RunRow extends Row {
  id: number
  workspace: string
  prompt: string
  target: string
  state: string
  root_run_id: number
  parent_run_id: number | null
  parent_step_path: string | null
  origin_session_id: string | null
  origin_harness: string | null
  origin_agent: string | null
  origin_kind: string
  pipeline_ref: string
  snapshot: string
  hash: string
  enforcement: string
  notification: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
  error: string | null
}

export interface StepRow extends Row {
  id: number
  run_id: number
  path: string
  parent_path: string | null
  name: string
  type: string
  status: string
  attempt: number
  max_attempts: number
  prompt: string | null
  model: string | null
  provider: string | null
  policy: string | null
  limits: string | null
  background: number
  result: string | null
  error: string | null
  lease_id: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  started_at: string | null
  finished_at: string | null
  current_attempt_id: number | null
  turns: number
  tokens: number
  tool_calls: number
  violations: number
  created_at: string
  updated_at: string
}

/**
 * One row per claim. `steps` keeps the live projection; this table is the
 * append-only history so retries can be inspected without losing usage,
 * timings, errors, or results.
 */
export interface StepAttemptRow extends Row {
  id: number
  run_id: number
  step_path: string
  attempt: number
  status: string
  turns: number
  tokens: number
  tool_calls: number
  violations: number
  error: string | null
  result: string | null
  model: string | null
  provider: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

/** A run row safe to return to MCP callers: the pinned tree stays internal. */
export type RunSummary = Omit<RunRow, 'snapshot'>

/**
 * A step row safe to return to MCP callers. Prompts, policy, limits, and lease
 * credentials are available only from the step detail endpoint; results stay
 * because status answers report what a step produced.
 */
export type StepSummary = Omit<
  StepRow,
  'prompt' | 'policy' | 'limits' | 'lease_id' | 'lease_owner' | 'lease_expires_at'
>

export function runSummary(run: RunRow): RunSummary {
  const { snapshot: _snapshot, ...summary } = run
  return summary
}

export function stepSummary(step: StepRow): StepSummary {
  const {
    prompt: _prompt,
    policy: _policy,
    limits: _limits,
    lease_id: _leaseId,
    lease_owner: _leaseOwner,
    lease_expires_at: _leaseExpiresAt,
    ...summary
  } = step
  return summary
}

export interface AlertRow extends Row {
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

export interface EventRow extends Row {
  id: number
  run_id: number
  attempt_id: number | null
  type: string
  payload: string
  created_at: string
}

export interface AdapterRow extends Row {
  id: string
  harness: string
  session_id: string | null
  workspace: string
  capabilities: string
  heartbeat_at: string
  created_at: string
}

export const now = (): string => new Date().toISOString()

export class Store {
  readonly db: Database.Database

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace TEXT NOT NULL,
        prompt TEXT NOT NULL,
        target TEXT NOT NULL,
        state TEXT NOT NULL,
        root_run_id INTEGER NOT NULL,
        parent_run_id INTEGER,
        parent_step_path TEXT,
        origin_session_id TEXT,
        origin_harness TEXT,
        origin_agent TEXT,
        origin_kind TEXT NOT NULL DEFAULT 'human',
        pipeline_ref TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        hash TEXT NOT NULL,
        enforcement TEXT NOT NULL DEFAULT 'observed',
        notification TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_state ON runs (state, id);
      CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs (parent_run_id, id);

      CREATE TABLE IF NOT EXISTS step_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_path TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        violations INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        result TEXT,
        model TEXT,
        provider TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, step_path, attempt)
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_run ON step_attempts (run_id, id);

      CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        parent_path TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        prompt TEXT,
        model TEXT,
        provider TEXT,
        policy TEXT,
        limits TEXT,
        background INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT,
        lease_id TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        current_attempt_id INTEGER REFERENCES step_attempts(id) ON DELETE SET NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        violations INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_steps_run ON steps (run_id, id);
      CREATE INDEX IF NOT EXISTS idx_steps_status ON steps (status);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        attempt_id INTEGER REFERENCES step_attempts(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_run ON events (run_id, id);

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_path TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (status, id);
      CREATE INDEX IF NOT EXISTS idx_alerts_run ON alerts (run_id, id);

      CREATE TABLE IF NOT EXISTS adapters (
        id TEXT PRIMARY KEY,
        harness TEXT NOT NULL,
        session_id TEXT,
        workspace TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_adapters_workspace ON adapters (workspace, heartbeat_at);
    `)
    this.ensureColumn('steps', 'provider', 'TEXT')
    this.ensureColumn('steps', 'current_attempt_id', 'INTEGER')
    this.ensureColumn('events', 'attempt_id', 'INTEGER')
  }

  /** Run a callback in one SQLite transaction (savepoints when nested). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (columns.some((entry) => entry.name === column)) return
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }

  run(id: number): RunRow | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
  }

  runs(): RunRow[] {
    return this.db.prepare('SELECT * FROM runs ORDER BY id DESC').all() as RunRow[]
  }

  activeRuns(): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE state IN ('queued','running','waiting') ORDER BY id")
      .all() as RunRow[]
  }

  steps(runID: number): StepRow[] {
    return this.db
      .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY id')
      .all(runID) as StepRow[]
  }

  step(runID: number, path: string): StepRow | undefined {
    return this.db.prepare('SELECT * FROM steps WHERE run_id = ? AND path = ?').get(runID, path) as
      StepRow | undefined
  }

  stepAttempts(runID: number, path?: string): StepAttemptRow[] {
    if (path === undefined) {
      return this.db
        .prepare('SELECT * FROM step_attempts WHERE run_id = ? ORDER BY id')
        .all(runID) as StepAttemptRow[]
    }
    return this.db
      .prepare('SELECT * FROM step_attempts WHERE run_id = ? AND step_path = ? ORDER BY attempt')
      .all(runID, path) as StepAttemptRow[]
  }

  stepAttempt(runID: number, path: string, attempt: number): StepAttemptRow | undefined {
    return this.db
      .prepare('SELECT * FROM step_attempts WHERE run_id = ? AND step_path = ? AND attempt = ?')
      .get(runID, path, attempt) as StepAttemptRow | undefined
  }

  insertStepAttempt(input: {
    run_id: number
    step_path: string
    attempt: number
    status: string
    model?: string | null
    provider?: string | null
    started_at?: string | null
  }): StepAttemptRow {
    const at = now()
    const info = this.db
      .prepare(
        `INSERT INTO step_attempts
          (run_id, step_path, attempt, status, model, provider, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.run_id,
        input.step_path,
        input.attempt,
        input.status,
        input.model ?? null,
        input.provider ?? null,
        input.started_at ?? at,
        at,
        at
      )
    return this.db
      .prepare('SELECT * FROM step_attempts WHERE id = ?')
      .get(info.lastInsertRowid) as StepAttemptRow
  }

  updateStepAttempt(id: number, fields: Partial<Record<string, unknown>>): void {
    const entries = Object.entries(fields)
    if (!entries.length) return
    const set = entries.map(([key]) => `${key} = ?`).join(', ')
    this.db
      .prepare(`UPDATE step_attempts SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), now(), id)
  }

  childRuns(runID: number, stepPath: string): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE parent_run_id = ? AND parent_step_path = ? ORDER BY id')
      .all(runID, stepPath) as RunRow[]
  }

  insertRun(input: {
    workspace: string
    prompt: string
    target: string
    root_run_id: number
    parent_run_id: number | null
    parent_step_path: string | null
    origin_session_id: string | null
    origin_harness: string | null
    origin_agent: string | null
    origin_kind: string
    pipeline_ref: string
    snapshot: string
    hash: string
    enforcement: string
    notification: string | null
  }): RunRow {
    const at = now()
    const info = this.db
      .prepare(
        `INSERT INTO runs
          (workspace, prompt, target, state, root_run_id, parent_run_id, parent_step_path,
           origin_session_id, origin_harness, origin_agent, origin_kind, pipeline_ref,
           snapshot, hash, enforcement, notification, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.workspace,
        input.prompt,
        input.target,
        input.root_run_id,
        input.parent_run_id,
        input.parent_step_path,
        input.origin_session_id,
        input.origin_harness,
        input.origin_agent,
        input.origin_kind,
        input.pipeline_ref,
        input.snapshot,
        input.hash,
        input.enforcement,
        input.notification,
        at,
        at
      )
    return this.run(Number(info.lastInsertRowid)) as RunRow
  }

  updateRun(id: number, fields: Partial<Record<string, unknown>>): void {
    const entries = Object.entries(fields)
    if (!entries.length) return
    const set = entries.map(([key]) => `${key} = ?`).join(', ')
    this.db
      .prepare(`UPDATE runs SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), now(), id)
  }

  ensureStep(
    run: RunRow,
    node: {
      path: string
      parent_path: string | null
      name: string
      type: string
      prompt?: string
      model?: string
      provider?: string
      policy?: unknown
      limits?: unknown
      background?: boolean
      max_attempts?: number
    }
  ): StepRow {
    const existing = this.step(Number(run.id), node.path)
    if (existing) return existing
    const at = now()
    this.db
      .prepare(
        `INSERT INTO steps
          (run_id, path, parent_path, name, type, status, attempt, max_attempts, prompt,
           model, provider, policy, limits, background, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        node.path,
        node.parent_path,
        node.name,
        node.type,
        node.max_attempts ?? 3,
        node.prompt ?? null,
        node.model ?? null,
        node.provider ?? null,
        node.policy === undefined ? null : JSON.stringify(node.policy),
        node.limits === undefined ? null : JSON.stringify(node.limits),
        node.background ? 1 : 0,
        at,
        at
      )
    return this.step(Number(run.id), node.path) as StepRow
  }

  updateStep(id: number, fields: Partial<Record<string, unknown>>): void {
    const entries = Object.entries(fields)
    if (!entries.length) return
    const set = entries.map(([key]) => `${key} = ?`).join(', ')
    this.db
      .prepare(`UPDATE steps SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), now(), id)
  }

  event(
    runID: number,
    type: string,
    payload: Record<string, unknown>,
    attemptID?: number | null
  ): EventRow {
    const at = now()
    const info = this.db
      .prepare(
        'INSERT INTO events (run_id, attempt_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(runID, attemptID ?? null, type, JSON.stringify(payload), at)
    return this.db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(info.lastInsertRowid) as EventRow
  }

  events(runID: number, since = 0, limit = 200): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(runID, since, limit) as EventRow[]
  }

  allEvents(since = 0, limit = 500): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?')
      .all(since, limit) as EventRow[]
  }

  alert(input: {
    run_id: number
    step_path: string | null
    kind: string
    title: string
    body: string
  }): AlertRow {
    const at = now()
    const info = this.db
      .prepare(
        `INSERT INTO alerts (run_id, step_path, kind, title, body, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(input.run_id, input.step_path, input.kind, input.title, input.body, at)
    return this.db
      .prepare('SELECT * FROM alerts WHERE id = ?')
      .get(info.lastInsertRowid) as AlertRow
  }

  alerts(status?: string): AlertRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM alerts WHERE status = ? ORDER BY id')
        .all(status) as AlertRow[]
    }
    return this.db.prepare('SELECT * FROM alerts ORDER BY id').all() as AlertRow[]
  }

  resolveAlert(id: number): void {
    this.db
      .prepare(
        "UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'"
      )
      .run(now(), id)
  }

  openAlerts(runID?: number): AlertRow[] {
    if (runID === undefined) {
      return this.alerts('open')
    }
    return this.db
      .prepare("SELECT * FROM alerts WHERE status = 'open' AND run_id = ? ORDER BY id")
      .all(runID) as AlertRow[]
  }

  adapter(id: string): AdapterRow | undefined {
    return this.db.prepare('SELECT * FROM adapters WHERE id = ?').get(id) as AdapterRow | undefined
  }

  upsertAdapter(input: {
    id: string
    harness: string
    session_id: string | null
    workspace: string
    capabilities: string[]
  }): AdapterRow {
    const at = now()
    this.db
      .prepare(
        `INSERT INTO adapters (id, harness, session_id, workspace, capabilities, heartbeat_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           harness = excluded.harness,
           session_id = excluded.session_id,
           workspace = excluded.workspace,
           capabilities = excluded.capabilities,
           heartbeat_at = excluded.heartbeat_at`
      )
      .run(
        input.id,
        input.harness,
        input.session_id,
        input.workspace,
        JSON.stringify(input.capabilities),
        at,
        at
      )
    return this.adapter(input.id) as AdapterRow
  }

  adapters(workspace?: string): AdapterRow[] {
    if (workspace) {
      return this.db
        .prepare('SELECT * FROM adapters WHERE workspace = ? ORDER BY heartbeat_at DESC')
        .all(workspace) as AdapterRow[]
    }
    return this.db
      .prepare('SELECT * FROM adapters ORDER BY heartbeat_at DESC')
      .all() as AdapterRow[]
  }

  heartbeatAdapter(id: string): void {
    this.db.prepare('UPDATE adapters SET heartbeat_at = ? WHERE id = ?').run(now(), id)
  }

  removeAdapter(id: string): void {
    this.db.prepare('DELETE FROM adapters WHERE id = ?').run(id)
  }
}
