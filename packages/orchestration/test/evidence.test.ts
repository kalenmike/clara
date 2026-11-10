import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRunEvidenceFile, runIdFromRequest } from '../src/evidence.ts'
import { now, Store } from '../src/store.ts'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function database(): { path: string; store: Store; runID: number; stepPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'clara-evidence-'))
  dirs.push(dir)
  const path = join(dir, 'orchestration.db')
  const store = new Store(path)
  const run = store.insertRun({
    workspace: '/work/clara',
    prompt: 'rebuild it',
    target: 'std:maintenance/rebuild',
    root_run_id: 0,
    parent_run_id: null,
    parent_step_path: null,
    origin_session_id: 'session-1',
    origin_harness: 'opencode',
    origin_agent: 'clara',
    origin_kind: 'human',
    pipeline_ref: 'rebuild',
    snapshot: JSON.stringify({
      root: { path: 'rebuild', name: 'Rebuild', title: 'Rebuild', kind: 'pipeline' },
    }),
    hash: 'sha256:test',
    enforcement: 'observed',
    notification: null,
  })
  store.updateRun(Number(run.id), { root_run_id: Number(run.id) })
  const updated = store.run(Number(run.id))!
  const step = store.ensureStep(updated, {
    path: 'rebuild/5-verify_health',
    parent_path: 'rebuild',
    name: 'verify_health',
    type: 'script',
  })
  store.updateStep(Number(step.id), { status: 'failed', error: 'health failed' })
  const attempt = store.insertStepAttempt({
    run_id: Number(run.id),
    step_path: step.path,
    attempt: 1,
    status: 'failed',
  })
  store.updateStepAttempt(Number(attempt.id), {
    error: 'health failed',
    exit_code: 1,
    result: '{"ok":false}',
  })
  store.alert({
    run_id: Number(run.id),
    step_path: step.path,
    kind: 'failure',
    title: 'Step failed: verify_health',
    body: 'health failed',
  })
  store.updateRun(Number(run.id), { state: 'failed', error: 'health failed', finished_at: now() })
  return { path, store, runID: Number(run.id), stepPath: step.path }
}

describe('run evidence', () => {
  it('reads the failed run, its attempts, and its alerts', () => {
    const { path, store, runID, stepPath } = database()
    try {
      store.db.close()
      const evidence = readRunEvidenceFile(path, { runId: runID })
      expect(evidence.available).toBe(true)
      expect(evidence.source).toBe('database')
      expect(evidence.run).toMatchObject({ id: runID, state: 'failed' })
      expect(evidence.run).not.toHaveProperty('prompt')
      expect(evidence.steps.map((step) => step.path)).toEqual([stepPath])
      expect(evidence.attempts[0]).toMatchObject({
        step_path: stepPath,
        status: 'failed',
        exit_code: 1,
      })
      expect(evidence.alerts[0]).toMatchObject({ kind: 'failure' })
      expect(evidence.failure).toMatchObject({
        step_path: stepPath,
        attempt: 1,
        error: 'health failed',
      })
    } finally {
      if (store.db.open) store.db.close()
    }
  })

  it('prefers the latest failed root run for the workspace', () => {
    const { path, store, runID } = database()
    const second = store.insertRun({
      workspace: '/work/clara',
      prompt: 'rebuild again',
      target: 'std:maintenance/rebuild',
      root_run_id: 0,
      parent_run_id: null,
      parent_step_path: null,
      origin_session_id: 'session-2',
      origin_harness: 'opencode',
      origin_agent: 'clara',
      origin_kind: 'human',
      pipeline_ref: 'rebuild',
      snapshot: '{}',
      hash: 'sha256:test-2',
      enforcement: 'observed',
      notification: null,
    })
    store.updateRun(Number(second.id), { state: 'failed', error: 'second' })
    try {
      store.db.close()
      const evidence = readRunEvidenceFile(path, { workspace: '/work/clara' })
      expect(evidence.run?.id).toBe(Number(second.id))
      expect(evidence.run?.id).not.toBe(runID)
      const missing = readRunEvidenceFile(path, { workspace: '/elsewhere' })
      expect(missing.available).toBe(false)
    } finally {
      if (store.db.open) store.db.close()
    }
  })

  it('parses a run id from a request file', () => {
    expect(runIdFromRequest('diagnose run 42')).toBe(42)
    expect(runIdFromRequest('why did #7 fail?')).toBe(7)
    expect(runIdFromRequest('diagnose the last rebuild')).toBeUndefined()
    expect(runIdFromRequest('run 0')).toBeUndefined()
  })
})
