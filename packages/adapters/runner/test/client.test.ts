import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RunnerClient } from '../src/client.ts'

let server: Server
let url = ''
const seen: Array<{ method: string; path: string; authorization: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      path: req.url ?? '',
      authorization: String(req.headers.authorization ?? ''),
    })
    if (req.url?.startsWith('/v1/adapters')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify([
          {
            id: 'runner-1',
            harness: 'opencode',
            role: 'runner',
            machine: 'host',
            labels: '[]',
            session_id: null,
            workspace: '/workspace/g',
            capabilities: '["script"]',
            heartbeat_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
        ])
      )
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('RunnerClient.adapters', () => {
  it('lists every registration without a workspace', async () => {
    const client = new RunnerClient({ url, token: 'tok' })
    const rows = await client.adapters()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('runner-1')
    const last = seen.at(-1)
    expect(last?.path).toBe('/v1/adapters')
    expect(last?.authorization).toBe('Bearer tok')
  })

  it('scopes the query to one encoded workspace', async () => {
    const client = new RunnerClient({ url, token: 'tok' })
    await client.adapters('/workspace/a b')
    expect(seen.at(-1)?.path).toBe('/v1/adapters?workspace=%2Fworkspace%2Fa%20b')
  })

  it('follows the resolve hook to a new endpoint', async () => {
    const client = new RunnerClient({
      url: 'http://127.0.0.1:1',
      token: 'stale',
      resolve: () => ({ url, token: 'fresh' }),
    })
    const rows = await client.adapters()
    expect(rows).toHaveLength(1)
    expect(seen.at(-1)?.authorization).toBe('Bearer fresh')
  })
})
