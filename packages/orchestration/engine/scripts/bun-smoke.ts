import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store.ts'

/**
 * Bun-only smoke test for the shared SQLite driver. The normal suite runs on
 * Node; this exercises the engine store through `@clara/sqlite`, which resolves
 * `bun:sqlite` under Bun.
 *
 *   bun scripts/bun-smoke.ts
 */
const dir = mkdtempSync(join(tmpdir(), 'clara-engine-bun-'))
const path = join(dir, 'orchestration.db')
let store: Store | undefined

try {
  const db = new Store(path)
  store = db

  const journal = String(db.db.pragma('journal_mode', { simple: true })).toLowerCase()
  if (journal !== 'wal') throw new Error(`expected WAL, got ${journal}`)

  const run = db.insertRun({
    workspace: dir,
    prompt: 'smoke',
    target: 'smoke',
    root_run_id: 0,
    parent_run_id: null,
    parent_step_path: null,
    origin_session_id: null,
    origin_harness: null,
    origin_agent: null,
    origin_kind: 'human',
    pipeline_ref: 'smoke',
    snapshot: '{}',
    hash: 'smoke',
    enforcement: 'observed',
    notification: null,
  })
  if (run.id !== 1) throw new Error(`insertRun returned id ${run.id}`)
  if (run.state !== 'queued') throw new Error(`insertRun returned state ${run.state}`)
  if (db.run(1)?.prompt !== 'smoke') throw new Error('run did not round-trip')
  if (db.run(999) !== undefined) throw new Error('a missing row was not undefined')

  const step = db.ensureStep(run, {
    path: 'build',
    parent_path: null,
    name: 'build',
    type: 'agent',
  })
  if (step.run_id !== 1) throw new Error('step did not round-trip')
  if (db.steps(1).length !== 1) throw new Error('expected one step')

  const event = db.event(1, 'run.started', { source: 'smoke' })
  if (event.id !== 1) throw new Error('event did not round-trip')
  if (db.events(1).length !== 1) throw new Error('expected one event')

  const alert = db.alert({
    run_id: 1,
    step_path: 'build',
    kind: 'failed',
    title: 'smoke',
    body: 'smoke',
  })
  if (alert.status !== 'open') throw new Error('alert did not round-trip')
  if (db.openAlerts(1).length !== 1) throw new Error('expected one open alert')

  const committed = db.transaction(() => {
    db.updateRun(1, { state: 'running' })
    return 'committed'
  })
  if (committed !== 'committed') throw new Error('transaction did not return its value')
  if (db.run(1)?.state !== 'running') throw new Error('transaction did not commit')

  let rolledBack = false
  try {
    db.transaction(() => {
      db.updateRun(1, { state: 'failed' })
      throw new Error('rollback')
    })
  } catch (error) {
    rolledBack = error instanceof Error && error.message === 'rollback'
  }
  if (!rolledBack) throw new Error('transaction did not throw')
  if (db.run(1)?.state !== 'running') throw new Error('transaction did not roll back')

  console.log(`engine bun sqlite smoke passed (${path})`)
} finally {
  store?.db.close()
  rmSync(dir, { recursive: true, force: true })
}
