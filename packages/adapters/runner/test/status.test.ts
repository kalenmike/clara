import { describe, expect, it } from 'vitest'
import { RUNNER_STALE_MS, runnerSnapshots } from '../src/status.ts'
import type { EngineAdapterRow } from '../src/types.ts'

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0)

function row(overrides: Partial<EngineAdapterRow> = {}): EngineAdapterRow {
  return {
    id: 'clara-runner-1',
    harness: 'opencode',
    role: 'runner',
    machine: 'host',
    labels: '["fast"]',
    session_id: null,
    workspace: '/workspace/clara',
    capabilities: '["script"]',
    heartbeat_at: new Date(NOW - 5_000).toISOString(),
    created_at: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  }
}

describe('runnerSnapshots', () => {
  it('marks a fresh runner live and an old runner stale', () => {
    const snapshots = runnerSnapshots(
      [
        row(),
        row({ id: 'old', heartbeat_at: new Date(NOW - RUNNER_STALE_MS - 1_000).toISOString() }),
      ],
      { nowMs: NOW }
    )
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]?.id).toBe('clara-runner-1')
    expect(snapshots[0]?.live).toBe(true)
    expect(snapshots[0]?.ageMs).toBe(5_000)
    expect(snapshots[1]?.id).toBe('old')
    expect(snapshots[1]?.live).toBe(false)
  })

  it('filters harness rows and sorts live runners before stale ones', () => {
    const snapshots = runnerSnapshots(
      [
        row({ id: 'stale', heartbeat_at: new Date(NOW - 300_000).toISOString() }),
        row({ id: 'harness-row', role: 'harness' }),
        row({ id: 'fresh', heartbeat_at: new Date(NOW - 1_000).toISOString() }),
      ],
      { nowMs: NOW }
    )
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['fresh', 'stale'])
  })

  it('parses labels and capabilities, tolerating malformed JSON', () => {
    const snapshots = runnerSnapshots(
      [row({ labels: 'not json', capabilities: '["script", 1, "extra"]' })],
      { nowMs: NOW }
    )
    expect(snapshots[0]?.labels).toEqual([])
    expect(snapshots[0]?.capabilities).toEqual(['script', 'extra'])
  })

  it('treats an unparseable heartbeat as stale', () => {
    const snapshots = runnerSnapshots([row({ heartbeat_at: 'garbage' })], { nowMs: NOW })
    expect(snapshots[0]?.live).toBe(false)
  })
})
