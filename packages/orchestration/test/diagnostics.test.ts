import { describe, expect, it } from 'vitest'
import { analyzeDatabase, Store, type RunRow } from '../src/index.ts'

const NOW = new Date('2026-11-08T12:00:00.000Z')
const RECENT = '2026-11-08T10:00:00.000Z'

interface SeedRunInput {
  pipeline?: string
  state?: string
  error?: string | null
  created_at?: string
  finished_at?: string | null
  enforcement?: string
}

function seedRun(store: Store, input: SeedRunInput = {}): RunRow {
  const created = input.created_at ?? RECENT
  const run = store.insertRun({
    workspace: '/workspace/clara',
    prompt: 'diagnose the orchestrator',
    target: 'std:diagnostics',
    root_run_id: 0,
    parent_run_id: null,
    parent_step_path: null,
    origin_session_id: null,
    origin_harness: null,
    origin_agent: null,
    origin_kind: 'human',
    pipeline_ref: input.pipeline ?? 'classifier',
    snapshot: '{}',
    hash: 'sha256:test',
    enforcement: input.enforcement ?? 'observed',
    notification: null,
  })
  store.updateRun(run.id, {
    state: input.state ?? 'failed',
    error: input.error ?? 'pipeline failed',
    created_at: created,
    updated_at: input.finished_at ?? created,
    finished_at: input.finished_at === undefined ? created : input.finished_at,
    root_run_id: run.id,
  })
  return store.run(run.id) as RunRow
}

interface SeedStepInput {
  path: string
  name: string
  status: string
  type?: string
  attempt?: number
  maxAttempts?: number
  error?: string | null
  model?: string | null
  provider?: string | null
  at?: string
}

function seedStep(store: Store, run: RunRow, input: SeedStepInput) {
  const at = input.at ?? RECENT
  const step = store.ensureStep(run, {
    path: input.path,
    parent_path: null,
    name: input.name,
    type: input.type ?? 'task',
    max_attempts: input.maxAttempts ?? 3,
  })
  store.updateStep(step.id, {
    status: input.status,
    attempt: input.attempt ?? 1,
    error: input.error ?? null,
    model: input.model === undefined ? 'deepseek-v4.1-flash' : input.model,
    provider: input.provider === undefined ? 'opencode-go' : input.provider,
    started_at: at,
    finished_at: input.status === 'running' || input.status === 'ready' ? null : at,
    created_at: at,
    updated_at: at,
  })
  return store.step(run.id, input.path)
}

function seedAlert(
  store: Store,
  run: RunRow,
  input: {
    kind: string
    title: string
    body: string
    status?: string
    created_at?: string
    step_path?: string
  }
) {
  const alert = store.alert({
    run_id: run.id,
    step_path: input.step_path ?? null,
    kind: input.kind,
    title: input.title,
    body: input.body,
  })
  store.db
    .prepare('UPDATE alerts SET status = ?, created_at = ? WHERE id = ?')
    .run(input.status ?? 'open', input.created_at ?? RECENT, alert.id)
  return alert
}

describe('orchestration diagnostics', () => {
  it('returns an empty, valid report for an empty database', () => {
    const store = new Store(':memory:')
    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.available).toBe(true)
    expect(report.runs.total).toBe(0)
    expect(report.steps.total).toBe(0)
    expect(report.pipelines).toEqual([])
    expect(report.errors).toEqual([])
    expect(report.anomalies).toEqual([])
  })

  it('identifies a consistently failing step and derives its pipeline', () => {
    const store = new Store(':memory:')
    for (let index = 0; index < 3; index++) {
      const run = seedRun(store)
      seedStep(store, run, {
        path: 'orchestration/route-software-development/route-feature/1-create_spec',
        name: 'create_spec',
        status: 'failed',
        attempt: 3,
        maxAttempts: 3,
        error: 'heartbeat stalled',
      })
    }

    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.runs.failed).toBe(3)
    expect(report.pipelines.find((entry) => entry.pipeline === 'feature')?.failed).toBe(3)
    const step = report.step_health.find((entry) => entry.name === 'create_spec')
    expect(step).toMatchObject({ failures: 3, exhausted: 3, runs: 3 })
    const error = report.errors.find((entry) => entry.signature === 'heartbeat stalled')
    expect(error).toMatchObject({ category: 'stalled', count: 3 })
    expect(report.anomalies.map((entry) => entry.code)).toContain('retry_exhaustion')
    expect(report.recent_failures).toHaveLength(3)
    expect(report.recent_failures[0].failed_steps).toEqual(['create_spec'])
  })

  it('groups different error text into one signature', () => {
    const store = new Store(':memory:')
    const first = seedRun(store)
    seedStep(store, first, {
      path: 'orchestration/route-feature/1-create_spec',
      name: 'create_spec',
      status: 'failed',
      error: 'lease expired for run 12',
    })
    const second = seedRun(store)
    seedStep(store, second, {
      path: 'orchestration/route-feature/1-create_spec',
      name: 'create_spec',
      status: 'failed',
      error: 'lease expired for run 99',
    })

    const report = analyzeDatabase(store.db, { now: NOW })
    const error = report.errors.find((entry) => entry.category === 'lease')
    expect(error?.signature).toBe('lease expired for <ref>')
    expect(error?.count).toBe(2)
    expect(error?.run_ids).toHaveLength(2)
  })

  it('flags duplicate terminal events as an event storm', () => {
    const store = new Store(':memory:')
    const run = seedRun(store)
    for (let index = 0; index < 20; index++) store.event(run.id, 'run.failed', {})
    const report = analyzeDatabase(store.db, { now: NOW })
    const anomaly = report.anomalies.find((entry) => entry.code === 'terminal_event_storm')
    expect(anomaly?.severity).toBe('high')
    expect(anomaly?.evidence.total).toBe(1)
    expect(JSON.stringify(anomaly?.evidence)).toContain('"count":20')
  })

  it('flags an alert backlog, duplicates, and stalled dominance', () => {
    const store = new Store(':memory:')
    const run = seedRun(store)
    for (let index = 0; index < 6; index++) {
      seedAlert(store, run, {
        kind: 'stalled',
        title: index < 2 ? 'Stalled step: classifier' : `Stalled step: worker ${index}`,
        body: 'The worker stopped reporting heartbeats.',
      })
    }
    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.alerts.open).toBe(6)
    expect(report.alerts.duplicate_groups).toBe(1)
    const codes = report.anomalies.map((entry) => entry.code)
    expect(codes).toContain('open_alert_backlog')
    expect(codes).toContain('duplicate_alerts')
    expect(codes).toContain('stalled_dominance')
  })

  it('filters runs outside the requested window', () => {
    const store = new Store(':memory:')
    seedRun(store, {
      state: 'failed',
      created_at: '2026-09-01T10:00:00.000Z',
      finished_at: '2026-09-01T10:05:00.000Z',
    })
    seedRun(store, { state: 'failed' })
    const report = analyzeDatabase(store.db, { days: 30, now: NOW })
    expect(report.window.since).toBe('2026-10-09T12:00:00.000Z')
    expect(report.runs.total).toBe(1)
  })

  it('flags task rows without a model or provider', () => {
    const store = new Store(':memory:')
    const run = seedRun(store, { state: 'completed', error: null })
    seedStep(store, run, {
      path: 'orchestration/route-feature/1-create_spec',
      name: 'create_spec',
      status: 'done',
      model: null,
      provider: null,
    })
    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.anomalies.map((entry) => entry.code)).toContain('missing_model_provider')
  })

  it('flags strict runs without a registered adapter', () => {
    const store = new Store(':memory:')
    seedRun(store, { enforcement: 'strict' })
    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.anomalies.map((entry) => entry.code)).toContain('adapter_missing')
  })

  it('flags a stale adapter heartbeat', () => {
    const store = new Store(':memory:')
    seedRun(store, { enforcement: 'strict' })
    const adapter = store.upsertAdapter({
      id: 'adapter-1',
      harness: 'opencode',
      session_id: 'ses_test',
      workspace: '/workspace/clara',
      capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
    })
    store.db
      .prepare('UPDATE adapters SET heartbeat_at = ? WHERE id = ?')
      .run('2026-11-08T09:00:00.000Z', adapter.id)
    const report = analyzeDatabase(store.db, { now: NOW })
    expect(report.anomalies.map((entry) => entry.code)).toContain('stale_adapter')
  })
})
