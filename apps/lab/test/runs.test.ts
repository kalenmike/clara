import { describe, expect, it } from 'vitest'
import type { RunRow } from '../src/types'
import { debugRuns, isActiveRun, isDebugRun, sortRuns, visibleRuns } from '../src/lib/runs'

function run(id: number, overrides: Partial<RunRow> = {}): RunRow {
  return {
    id,
    workspace: '/workspace',
    prompt: `prompt ${id}`,
    target: 'std:software',
    state: 'completed',
    root_run_id: id,
    parent_run_id: null,
    parent_step_path: null,
    origin_session_id: null,
    origin_harness: 'opencode',
    origin_agent: 'clara',
    origin_kind: 'agent',
    pipeline_ref: 'software',
    hash: 'sha256:abc',
    enforcement: 'observed',
    notification: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    error: null,
    ...overrides,
  }
}

describe('lab run origins', () => {
  it('recognises only clara-lab runs as debug runs', () => {
    expect(isDebugRun(run(1, { origin_harness: 'clara-lab' }))).toBe(true)
    expect(isDebugRun(run(2, { origin_harness: 'opencode' }))).toBe(false)
    expect(isDebugRun(run(3, { origin_harness: null }))).toBe(false)
  })

  it('separates debug runs from owned runs', () => {
    const runs = [
      run(1, { origin_harness: 'opencode' }),
      run(2, { origin_harness: 'clara-lab' }),
      run(3, { origin_harness: null }),
    ]
    expect(debugRuns(runs).map((entry) => entry.id)).toEqual([2])
  })

  it('hides debug runs unless they are explicitly shown', () => {
    const runs = [run(1, { origin_harness: 'opencode' }), run(2, { origin_harness: 'clara-lab' })]
    expect(visibleRuns(runs, false).map((entry) => entry.id)).toEqual([1])
    expect(visibleRuns(runs, true).map((entry) => entry.id)).toEqual([1, 2])
  })

  it('sorts active runs before finished runs without reordering groups', () => {
    const runs = [
      run(1, { state: 'completed' }),
      run(2, { state: 'running' }),
      run(3, { state: 'failed' }),
      run(4, { state: 'queued' }),
    ]
    expect(sortRuns(runs).map((entry) => entry.id)).toEqual([2, 4, 1, 3])
  })

  it('treats running, waiting, and queued as active', () => {
    expect(isActiveRun(run(1, { state: 'running' }))).toBe(true)
    expect(isActiveRun(run(2, { state: 'waiting' }))).toBe(true)
    expect(isActiveRun(run(3, { state: 'queued' }))).toBe(true)
    expect(isActiveRun(run(4, { state: 'completed' }))).toBe(false)
    expect(isActiveRun(run(5, { state: 'cancelled' }))).toBe(false)
  })
})
