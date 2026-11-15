import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Runtime, Store, defaultConfigPath } from '@clara/orchestration'
import { createEngineServer, type EngineServer } from '../../../apps/engine/src/server.ts'
import { startLabServer, type LabServer } from '../server/http.ts'
import { LabRuntime } from '../server/runtime.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const config = defaultConfigPath()
if (!config) throw new Error('bundled default config is missing')
const token = 'lab-test-token'
let orchestrator: EngineServer
let lab: LabServer
let runtime: LabRuntime
let store: Store
let base: string

async function post(path: string, body: unknown): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clara-lab': '1' },
    body: JSON.stringify(body),
  })
  return { response, value: await response.json() }
}

async function get(path: string): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(`${base}${path}`)
  return { response, value: await response.json() }
}

async function waitForEvents(runID: number): Promise<Array<{ run_id: number; type: string }>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await get('/api/state')
    const events = (state.value as { events: Array<{ run_id: number; type: string }> }).events
    if (events.some((event) => event.run_id === runID)) return events
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`no SSE event arrived for run ${runID}`)
}

beforeAll(async () => {
  store = new Store(':memory:')
  const orchestrationRuntime = new Runtime({
    store,
  })
  orchestrator = createEngineServer({
    runtime: orchestrationRuntime,
    token,
    port: 0,
    tickMs: 60_000,
    workspace,
  })
  await new Promise<void>((resolve) => orchestrator.server.listen(0, '127.0.0.1', () => resolve()))
  const address = orchestrator.server.address() as AddressInfo
  runtime = new LabRuntime({
    url: `http://127.0.0.1:${address.port}`,
    token,
    workspace,
  })
  await runtime.start()
  lab = await startLabServer({ runtime, port: 0, version: 'test' })
  base = lab.url.replace(/\/$/, '')
})

afterAll(async () => {
  await lab.close()
  await runtime.stop()
  await orchestrator.close()
  store.db.close()
})

describe('lab server', () => {
  it('reports health and previews a target', async () => {
    const health = await get('/api/health')
    expect(health.response.status).toBe(200)
    expect(health.value).toMatchObject({
      service: 'clara-lab',
      connected: true,
      engineWorkspace: workspace,
      pid: expect.any(Number),
      port: expect.any(Number),
      root: expect.any(String),
      startedAt: expect.any(String),
    })

    const state = await get('/api/state')
    expect(state.value).toMatchObject({ engineWorkspace: workspace })

    const preview = await post('/api/preview', { workspace, target: 'std:maintenance/rebuild' })
    expect(preview.response.status).toBe(200)
    const value = preview.value as {
      compiled?: { root: { kind: string } }
      selected?: { ref: string }
      sources: Array<{ path: string; kind: string }>
    }
    expect(value.selected?.ref).toBe('std:maintenance/rebuild')
    expect(value.compiled?.root.kind).toBe('pipeline')
    expect(value.sources.some((source) => source.kind === 'pipeline')).toBe(true)
  })

  it('requires the lab header for mutations', async () => {
    const response = await fetch(`${base}/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(response.status).toBe(403)
  })

  it('probes the MCP tool surface and tracks claimed work', async () => {
    const started = await post('/api/tools/clara_start', {
      prompt: 'lab server test',
      workspace,
      target: 'std:maintenance/rebuild',
      origin: { harness: 'clara-lab', kind: 'agent' },
    })
    expect(started.response.status).toBe(200)
    const value = started.value as {
      value: { run: { id: number }; work: Array<{ step_path: string; work_token: string }> }
    }
    expect(value.value.work).toHaveLength(1)
    const runID = value.value.run.id
    const order = value.value.work[0]

    const events = await waitForEvents(runID)
    expect(events.some((event) => event.type === 'run.started')).toBe(true)

    const state = await get('/api/state')
    expect((state.value as { work: unknown[] }).work).toHaveLength(1)

    const completed = await post('/api/tools/clara_complete', {
      run_id: runID,
      step_path: order.step_path,
      work_token: order.work_token,
      result: 'done',
    })
    expect(completed.response.status).toBe(200)
    const after = await get('/api/state')
    expect((after.value as { work: unknown[] }).work).toHaveLength(0)

    const next = await post('/api/tools/clara_next', { run_id: runID, limit: 8 })
    expect((next.value as { value: unknown[] }).value).toHaveLength(1)

    const status = await get(`/api/runs/${runID}`)
    const statusValue = (
      status.value as {
        value: {
          run: { hash: string }
          steps: Array<Record<string, unknown>>
          stepCount?: number
        }
      }
    ).value
    expect(statusValue.steps.length).toBeGreaterThan(1)
    expect(statusValue.steps.every((step) => !('prompt' in step))).toBe(true)
    expect(statusValue.stepCount).toBeGreaterThan(0)

    const scriptStep =
      statusValue.steps.find((step) => step.type === 'script') ?? statusValue.steps[0]
    const stepPath = String(scriptStep.path)
    const detail = await get(`/api/runs/${runID}/steps/${encodeURIComponent(stepPath)}`)
    expect((detail.value as { path: string }).path).toBe(stepPath)
    expect(typeof (detail.value as { script?: { command?: string } }).script?.command).toBe(
      'string'
    )
  })

  it('compares a pinned run with the current files', async () => {
    const runs = await get('/api/runs')
    const list = (runs.value as { value: Array<{ id: number; target: string }> }).value
    const run = list.find((entry) => entry.target === 'std:maintenance/rebuild')
    expect(run).toBeTruthy()
    const diff = await post('/api/diff', {
      run_id: run?.id,
      workspace,
      target: 'std:maintenance/rebuild',
    })
    expect(diff.response.status).toBe(200)
    expect((diff.value as { diff: { summary: { added: number } } }).diff.summary.added).toBe(0)
  })

  it('only reads files that belong to the preview', async () => {
    await post('/api/preview', { workspace, target: 'std:maintenance/rebuild' })
    const allowed = await get(`/api/source?path=${encodeURIComponent(config)}`)
    expect(allowed.response.status).toBe(200)
    expect((allowed.value as { text: string }).text).toContain('classifier')

    const denied = await get('/api/source?path=%2Fetc%2Fpasswd')
    expect(denied.response.status).toBe(403)
  })

  it('preflights the host and orchestrator workspaces', async () => {
    const quick = await post('/api/preflight', {
      hostWorkspace: workspace,
      target: 'std:maintenance/rebuild',
    })
    expect(quick.response.status).toBe(200)
    const quickValue = quick.value as {
      host: { ok: boolean; strict?: boolean }
      runtime: { ok: boolean; packages?: number }
      adapter: { required: boolean; ok: boolean }
    }
    expect(quickValue.host.ok).toBe(true)
    expect(quickValue.host.strict).toBe(false)
    expect(quickValue.runtime.ok).toBe(true)
    expect(quickValue.adapter.required).toBe(false)

    const strict = await post('/api/preflight', {
      hostWorkspace: workspace,
      runtimeWorkspace: workspace,
      target: 'std:software/feature',
    })
    const strictValue = strict.value as {
      host: { ok: boolean; strict?: boolean }
      adapter: { required: boolean; ok: boolean }
    }
    expect(strictValue.host.ok).toBe(true)
    expect(strictValue.host.strict).toBe(true)
    expect(strictValue.adapter.required).toBe(true)
    expect(strictValue.adapter.ok).toBe(false)

    const missing = await post('/api/preflight', {
      hostWorkspace: workspace,
      runtimeWorkspace: '/definitely/not/here',
      target: 'std:maintenance/rebuild',
    })
    const missingValue = missing.value as {
      host: { ok: boolean }
      runtime: { ok: boolean; error?: string }
    }
    expect(missingValue.host.ok).toBe(true)
    expect(missingValue.runtime.ok).toBe(false)
    expect(missingValue.runtime.error).toBeTruthy()
  })

  it('cancels every non-terminal root run', async () => {
    const first = await post('/api/tools/clara_start', {
      prompt: 'cancel all first',
      workspace,
      target: 'std:maintenance/rebuild',
      origin: { harness: 'clara-lab', kind: 'agent' },
    })
    const second = await post('/api/tools/clara_start', {
      prompt: 'cancel all second',
      workspace,
      target: 'std:maintenance/rebuild',
      origin: { harness: 'clara-lab', kind: 'agent' },
    })
    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)

    const cancelled = await post('/api/runs/cancel-all', {})
    expect(cancelled.response.status).toBe(200)
    const value = cancelled.value as {
      cancelled: number
      failed: Array<{ id: number; error: string }>
    }
    expect(value.cancelled).toBeGreaterThanOrEqual(2)
    expect(value.failed).toHaveLength(0)

    const runs = await get('/api/runs')
    const list = (runs.value as { value: Array<{ id: number; state: string }> }).value
    for (const run of [first, second]) {
      const id = (run.value as { value: { run: { id: number } } }).value.run.id
      expect(list.find((entry) => entry.id === id)?.state).toBe('cancelled')
    }
  })

  it('registers an adapter for strict targets', async () => {
    const registered = await post('/api/adapter/register', {})
    expect(registered.response.status).toBe(200)
    const preflight = await post('/api/preflight', {
      hostWorkspace: workspace,
      runtimeWorkspace: workspace,
      target: 'std:software/feature',
    })
    const preflightValue = preflight.value as { adapter: { required: boolean; ok: boolean } }
    expect(preflightValue.adapter.required).toBe(true)
    expect(preflightValue.adapter.ok).toBe(true)
    const started = await post('/api/tools/clara_start', {
      prompt: 'strict lab test',
      workspace,
      target: 'std:software/feature',
      origin: { harness: 'clara-lab', kind: 'agent' },
    })
    expect(started.response.status).toBe(200)
    const value = started.value as { value: { run: { id: number } } }
    await post('/api/tools/clara_cancel', { run_id: value.value.run.id, reason: 'test cleanup' })
  })
})
