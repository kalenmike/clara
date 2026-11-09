import { describe, expect, it } from 'vitest'
import { resolveStepWiring } from '../server/step-wiring.ts'
import type { StepSummary } from '../server/types.ts'

function snapshot(): string {
  return JSON.stringify({
    path: '/',
    kind: 'pipeline',
    title: 'root',
    children: [
      {
        path: '/collect',
        kind: 'task',
        title: 'Collect',
        inputs: { source: '/source' },
        artifacts: { report: 'reports/out.md' },
      },
      {
        path: '/source',
        kind: 'task',
        title: 'Source',
      },
    ],
  })
}

function step(path: string, overrides: Partial<StepSummary> = {}): StepSummary {
  return {
    id: 1,
    run_id: 1,
    path,
    parent_path: null,
    name: path,
    type: 'task',
    status: 'done',
    attempt: 1,
    max_attempts: 1,
    model: null,
    provider: null,
    background: 0,
    result: null,
    error: null,
    heartbeat_at: null,
    started_at: null,
    finished_at: null,
    turns: 0,
    tokens: 0,
    tool_calls: 0,
    violations: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveStepWiring', () => {
  it('resolves declared inputs and artifacts against run steps', () => {
    const wiring = resolveStepWiring(snapshot(), '/collect', [
      step('/source', {
        name: 'Source',
        result: JSON.stringify({ summary: 'done' }),
      }),
    ])

    expect(wiring.inputs).toEqual([
      {
        label: 'source',
        path: '/source',
        name: 'Source',
        status: 'done',
        result: { summary: 'done' },
      },
    ])
    expect(wiring.artifacts).toEqual([{ label: 'report', path: 'reports/out.md' }])
    expect(wiring.request).toBe(true)
  })

  it('keeps an input without a result pending', () => {
    const wiring = resolveStepWiring(snapshot(), '/collect', [
      step('/source', { name: 'Source', status: 'running' }),
    ])

    expect(wiring.inputs[0]).toMatchObject({
      label: 'source',
      name: 'Source',
      status: 'running',
      result: null,
    })
  })

  it('falls back to the path when the input step is missing', () => {
    const wiring = resolveStepWiring(snapshot(), '/collect', [])
    expect(wiring.inputs[0]).toMatchObject({
      label: 'source',
      path: '/source',
      name: '/source',
      result: null,
    })
  })

  it('returns empty wiring without a snapshot or a matching node', () => {
    expect(resolveStepWiring(undefined, '/collect', [])).toEqual({
      inputs: [],
      artifacts: [],
      request: true,
    })
    expect(resolveStepWiring(snapshot(), '/missing', [])).toEqual({
      inputs: [],
      artifacts: [],
      request: true,
    })
  })

  it('returns empty wiring for a malformed snapshot', () => {
    expect(resolveStepWiring('not json', '/collect', [])).toEqual({
      inputs: [],
      artifacts: [],
      request: true,
    })
  })
})
