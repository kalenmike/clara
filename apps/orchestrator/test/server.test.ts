import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Runtime, Store } from '@clara/orchestration'
import { createOrchestratorServer, type OrchestratorServer } from '../src/server.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'test-token'
let app: OrchestratorServer
let base: string
let runtime: Runtime

beforeAll(async () => {
  const store = new Store(':memory:')
  runtime = new Runtime({ store, configPath: `${workspace}/orchestration/index.yml` })
  app = createOrchestratorServer({ runtime, token, port: 0, tickMs: 60_000, workspace })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()))
  const address = app.server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await app.close()
})

function auth(headers: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...headers }
}

describe('orchestrator HTTP service', () => {
  it('rejects unauthenticated requests but leaves health open', async () => {
    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
    const denied = await fetch(`${base}/v1/runs`)
    expect(denied.status).toBe(401)
  })

  it('advertises whether it runs locally or in a container', async () => {
    const previous = process.env.CLARA_ORCHESTRATION_CONTAINER
    try {
      delete process.env.CLARA_ORCHESTRATION_CONTAINER
      const local = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
      expect(local).toMatchObject({ ok: true, service: 'clara-orchestrator', mode: 'local' })

      process.env.CLARA_ORCHESTRATION_CONTAINER = '1'
      const container = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
      expect(container).toMatchObject({ mode: 'container' })
    } finally {
      if (previous === undefined) delete process.env.CLARA_ORCHESTRATION_CONTAINER
      else process.env.CLARA_ORCHESTRATION_CONTAINER = previous
    }
  })

  it('reports its configured workspace to authenticated callers', async () => {
    const denied = await fetch(`${base}/v1/config`)
    expect(denied.status).toBe(401)

    const response = await fetch(`${base}/v1/config`, { headers: auth() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ workspace })
  })

  it('returns the resolved package catalog', async () => {
    const response = await fetch(`${base}/v1/catalog?workspace=${encodeURIComponent(workspace)}`, {
      headers: auth(),
    })
    expect(response.status).toBe(200)
    const packages = (await response.json()) as Array<{
      id: string
      entry: Record<string, unknown>
    }>
    expect(Array.isArray(packages)).toBe(true)
    expect(packages.map((pkg) => pkg.id)).toEqual(
      expect.arrayContaining(['orchestration', 'software'])
    )
    expect(packages.find((pkg) => pkg.id === 'software')?.entry).toEqual({
      router: 'classifier',
    })
  })

  it('starts and advances a run through the REST API', async () => {
    const started = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ workspace, prompt: 'patch it', target: 'quick_patch' }),
    })
    expect(started.status).toBe(201)
    const body = (await started.json()) as {
      run: { id: number }
      work: Array<{ step_path: string; work_token: string; name: string }>
    }
    expect(body.work[0].name).toBe('patch_code')
    const completed = await fetch(
      `${base}/v1/runs/${body.run.id}/steps/${encodeURIComponent(body.work[0].step_path)}/complete`,
      {
        method: 'POST',
        headers: auth({ 'content-type': 'application/json' }),
        body: JSON.stringify({ work_token: body.work[0].work_token, result: 'done' }),
      }
    )
    expect(completed.status).toBe(200)
    const advanced = (await completed.json()) as { ready: Array<{ name: string }> }
    expect(advanced.ready[0].name).toBe('quick_verify')
  })

  it('requires the work token to renew a step lease', async () => {
    const started = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ workspace, prompt: 'patch it', target: 'quick_patch' }),
    })
    const body = (await started.json()) as {
      run: { id: number }
      work: Array<{ step_path: string; work_token: string }>
    }
    const path = encodeURIComponent(body.work[0].step_path)
    const url = `${base}/v1/runs/${body.run.id}/steps/${path}/heartbeat`

    const denied = await fetch(url, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({}),
    })
    expect(denied.status).toBe(422)
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('lease_invalid')

    const renewed = await fetch(url, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ work_token: body.work[0].work_token }),
    })
    expect(renewed.status).toBe(200)
    expect(((await renewed.json()) as { status: string }).status).toBe('running')
  })

  it('lists run summaries without pinned snapshots', async () => {
    for (const path of ['/v1/runs', '/v1/runs?summary=1']) {
      const response = await fetch(`${base}${path}`, { headers: auth() })
      expect(response.status).toBe(200)
      const runs = (await response.json()) as Array<Record<string, unknown>>
      expect(runs.length).toBeGreaterThan(0)
      expect(runs.every((run) => 'id' in run && !('snapshot' in run))).toBe(true)
    }
  })

  it('keeps prompts, lease tokens, and pinned trees out of status summaries', async () => {
    const list = (await (await fetch(`${base}/v1/runs`, { headers: auth() })).json()) as Array<{
      id: number
    }>
    const runID = list[0].id
    const status = (await (
      await fetch(`${base}/v1/runs/${runID}`, { headers: auth() })
    ).json()) as {
      run: Record<string, unknown>
      steps: Array<Record<string, unknown>>
      children: Array<Record<string, unknown>>
    }
    expect('snapshot' in status.run).toBe(false)
    expect(status.children.every((run) => !('snapshot' in run))).toBe(true)
    expect(status.steps.length).toBeGreaterThan(0)
    expect(
      status.steps.every(
        (step) =>
          !('prompt' in step) && !('policy' in step) && !('limits' in step) && !('lease_id' in step)
      )
    ).toBe(true)

    const denied = await fetch(`${base}/v1/runs/${runID}/snapshot`)
    expect(denied.status).toBe(401)

    const pinned = (await (
      await fetch(`${base}/v1/runs/${runID}/snapshot`, { headers: auth() })
    ).json()) as { run_id: number; hash: string; snapshot: string }
    expect(pinned.run_id).toBe(runID)
    expect(pinned.hash).toBe(String(status.run.hash))
    expect(JSON.parse(pinned.snapshot)).toMatchObject({ kind: 'pipeline' })

    const taskStep = status.steps.find((step) => step.type === 'task') ?? status.steps[0]
    const stepPath = String(taskStep.path)
    const detail = (await (
      await fetch(`${base}/v1/runs/${runID}/steps/${encodeURIComponent(stepPath)}`, {
        headers: auth(),
      })
    ).json()) as Record<string, unknown>
    expect(detail.path).toBe(stepPath)
    expect(typeof detail.prompt).toBe('string')
    expect('lease_id' in detail).toBe(true)
  })

  it('fails closed for strict runs until an adapter is registered', async () => {
    const denied = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ workspace, prompt: 'build it', target: 'std:software/feature' }),
    })
    expect(denied.status).toBe(422)
    const error = (await denied.json()) as { error: { code: string } }
    expect(error.error.code).toBe('enforcement_unavailable')

    const registered = await fetch(`${base}/v1/adapters/register`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        harness: 'opencode',
        workspace,
        capabilities: ['tool_policy', 'turn_limit', 'token_limit'],
      }),
    })
    expect(registered.status).toBe(200)

    const started = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ workspace, prompt: 'build it', target: 'std:software/feature' }),
    })
    expect(started.status).toBe(201)
  })

  it('returns attempt history per run and per step', async () => {
    const started = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ workspace, prompt: 'patch it', target: 'quick_patch' }),
    })
    const body = (await started.json()) as {
      run: { id: number }
      work: Array<{ step_path: string; work_token: string }>
    }
    const path = body.work[0].step_path
    const failed = await fetch(
      `${base}/v1/runs/${body.run.id}/steps/${encodeURIComponent(path)}/fail`,
      {
        method: 'POST',
        headers: auth({ 'content-type': 'application/json' }),
        body: JSON.stringify({ work_token: body.work[0].work_token, error: 'boom' }),
      }
    )
    expect(failed.status).toBe(200)

    const denied = await fetch(`${base}/v1/runs/${body.run.id}/attempts`)
    expect(denied.status).toBe(401)

    const all = (await (
      await fetch(`${base}/v1/runs/${body.run.id}/attempts`, { headers: auth() })
    ).json()) as Array<Record<string, unknown>>
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      run_id: body.run.id,
      step_path: path,
      attempt: 1,
      status: 'retry',
      error: 'boom',
    })

    const perStep = (await (
      await fetch(`${base}/v1/runs/${body.run.id}/steps/${encodeURIComponent(path)}/attempts`, {
        headers: auth(),
      })
    ).json()) as Array<Record<string, unknown>>
    expect(perStep).toHaveLength(1)

    const missing = await fetch(
      `${base}/v1/runs/${body.run.id}/steps/${encodeURIComponent('missing')}/attempts`,
      { headers: auth() }
    )
    expect(missing.status).toBe(422)
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('step_missing')
  })

  it('serves the MCP tool surface over Streamable HTTP', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: auth() },
    })
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain('clara_start')
    expect(tools.tools.map((tool) => tool.name)).toContain('clara_spawn')
    expect(tools.tools.map((tool) => tool.name)).toContain('clara_attempts')
    const result = await client.callTool({
      name: 'clara_start',
      arguments: { workspace, prompt: 'patch it', target: 'quick_patch' },
    })
    expect(result.isError).toBeFalsy()
    const started = result.structuredContent as {
      run: { id: number } & Record<string, unknown>
    }
    expect('snapshot' in started.run).toBe(false)

    const listed = await client.callTool({ name: 'clara_list', arguments: {} })
    const items = (listed.structuredContent as { items: Array<Record<string, unknown>> }).items
    expect(items.every((run) => !('snapshot' in run))).toBe(true)

    const status = await client.callTool({
      name: 'clara_status',
      arguments: { run_id: started.run.id },
    })
    const detail = status.structuredContent as {
      run: Record<string, unknown>
      steps: Array<Record<string, unknown>>
    }
    expect('snapshot' in detail.run).toBe(false)
    expect(detail.steps.every((step) => !('prompt' in step) && !('lease_id' in step))).toBe(true)

    const attempts = await client.callTool({
      name: 'clara_attempts',
      arguments: { run_id: started.run.id },
    })
    const attemptItems = (attempts.structuredContent as { items: Array<Record<string, unknown>> })
      .items
    expect(attemptItems.length).toBeGreaterThan(0)
    expect(attemptItems[0].step_path).toBeTruthy()
    await client.close()
  })
})
