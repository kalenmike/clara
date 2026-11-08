import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Runtime, Store } from '@clara/orchestration'
import { createOrchestratorServer, type OrchestratorServer } from '../../orchestrator/src/server.ts'
import { startLabServer, type LabServer } from '../server/http.ts'
import { LabRuntime } from '../server/runtime.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'lab-test-token'
let orchestrator: OrchestratorServer
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
  orchestrator = createOrchestratorServer({
    runtime: orchestrationRuntime,
    token,
    port: 0,
    tickMs: 60_000,
  })
  await new Promise<void>((resolve) => orchestrator.server.listen(0, '127.0.0.1', () => resolve()))
  const address = orchestrator.server.address() as AddressInfo
  runtime = new LabRuntime({
    url: `http://127.0.0.1:${address.port}`,
    token,
    workspace,
    models: async () => ({
      ok: true,
      reachable: true,
      url: 'http://opencode.test',
      models: [{ providerID: 'opencode-go', id: 'deepseek-v4.1-flash', enabled: true }],
      fetchedAt: new Date().toISOString(),
    }),
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
    expect(health.value).toMatchObject({ service: 'clara-lab', connected: true })

    const preview = await post('/api/preview', { workspace, target: 'quick_patch' })
    expect(preview.response.status).toBe(200)
    const value = preview.value as {
      compiled?: { root: { kind: string } }
      selected?: { ref: string }
      sources: Array<{ path: string; kind: string }>
    }
    expect(value.selected?.ref).toBe('quick_patch')
    expect(value.compiled?.root.kind).toBe('pipeline')
    expect(value.sources.some((source) => source.kind === 'pipeline')).toBe(true)
  })

  it('validates pipeline models against the OpenCode catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-lab-models-'))
    try {
      mkdirSync(join(dir, 'orchestration'))
      writeFileSync(
        join(dir, 'orchestration', 'index.yml'),
        [
          'id: temp',
          'name: Temp',
          'version: 1',
          'entry: bad',
          'pipelines:',
          '  bad:',
          '    steps:',
          '      - name: bad_model',
          '        type: task',
          '        prompt: do it',
          '        provider: opencode-go',
          '        model: not-a-model',
        ].join('\n')
      )
      const preview = await post('/api/preview', { workspace: dir, target: 'bad' })
      expect(preview.response.status).toBe(200)
      const value = preview.value as {
        modelCatalog?: { ok: boolean; count: number }
        diagnostics: Array<{ code: string; stepPath?: string }>
      }
      expect(value.modelCatalog?.ok).toBe(true)
      expect(value.modelCatalog?.count).toBe(1)
      expect(value.diagnostics.map((entry) => entry.code)).toContain('model_unknown')
    } finally {
      await post('/api/preview', { workspace, target: 'quick_patch' }).catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
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
      target: 'quick_patch',
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
    expect((status.value as { value: { steps: unknown[] } }).value.steps.length).toBeGreaterThan(1)
  })

  it('compares a pinned run with the current files', async () => {
    const runs = await get('/api/runs')
    const list = (runs.value as { value: Array<{ id: number; target: string }> }).value
    const run = list.find((entry) => entry.target === 'quick_patch')
    expect(run).toBeTruthy()
    const diff = await post('/api/diff', {
      run_id: run?.id,
      workspace,
      target: 'quick_patch',
    })
    expect(diff.response.status).toBe(200)
    expect((diff.value as { diff: { summary: { added: number } } }).diff.summary.added).toBe(0)
  })

  it('only reads files that belong to the preview', async () => {
    await post('/api/preview', { workspace, target: 'quick_patch' })
    const allowed = await get(
      `/api/source?path=${encodeURIComponent(join(workspace, 'orchestration', 'index.yml'))}`
    )
    expect(allowed.response.status).toBe(200)
    expect((allowed.value as { text: string }).text).toContain('is_active')

    const denied = await get('/api/source?path=%2Fetc%2Fpasswd')
    expect(denied.response.status).toBe(403)
  })

  it('preflights the host and orchestrator workspaces', async () => {
    const quick = await post('/api/preflight', {
      hostWorkspace: workspace,
      runtimeWorkspace: workspace,
      target: 'quick_patch',
    })
    expect(quick.response.status).toBe(200)
    const quickValue = quick.value as {
      host: { ok: boolean; strict?: boolean }
      runtime: { ok: boolean; packages?: number }
      adapter: { required: boolean; ok: boolean }
      models: { ok: boolean; count: number }
    }
    expect(quickValue.host.ok).toBe(true)
    expect(quickValue.host.strict).toBe(false)
    expect(quickValue.runtime.ok).toBe(true)
    expect(quickValue.adapter.required).toBe(false)
    expect(quickValue.models).toMatchObject({ ok: true, count: 1 })

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
      target: 'quick_patch',
    })
    const missingValue = missing.value as {
      host: { ok: boolean }
      runtime: { ok: boolean; error?: string }
    }
    expect(missingValue.host.ok).toBe(true)
    expect(missingValue.runtime.ok).toBe(false)
    expect(missingValue.runtime.error).toBeTruthy()
  })

  it('registers an adapter for strict targets', async () => {
    const registered = await post('/api/adapter/register', { workspace })
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
