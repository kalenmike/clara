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

  it('reports its configured workspace to authenticated callers', async () => {
    const denied = await fetch(`${base}/v1/config`)
    expect(denied.status).toBe(401)

    const response = await fetch(`${base}/v1/config`, { headers: auth() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ workspace })
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

  it('serves the MCP tool surface over Streamable HTTP', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: auth() },
    })
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain('clara_start')
    expect(tools.tools.map((tool) => tool.name)).toContain('clara_spawn')
    const result = await client.callTool({
      name: 'clara_start',
      arguments: { workspace, prompt: 'patch it', target: 'quick_patch' },
    })
    expect(result.isError).toBeFalsy()
    await client.close()
  })
})
