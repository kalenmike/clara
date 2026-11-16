import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineOrchestrator, readEngineConfig } from '../src/engine.ts'

function dataEnv(root: string): NodeJS.ProcessEnv {
  return { ...process.env, CLARA_DATA_DIR: join(root, 'data') }
}

async function startEngine(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ workspace: '/workspace/project' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('engine did not bind')
  return { url: `http://127.0.0.1:${address.port}`, server }
}

describe('engine orchestrator', () => {
  it('uses a reachable engine directly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-engine-'))
    const { url, server } = await startEngine()
    const orchestrator = new EngineOrchestrator({
      transport: { fetchEngine: async () => new Response('{}') },
      env: dataEnv(root),
    })
    try {
      await orchestrator.update({
        enabled: true,
        direct: [url],
        proxy: true,
        reachable: true,
        token: 'engine-token',
      })
      const config = readEngineConfig(dataEnv(root))
      expect(config?.enabled).toBe(true)
      expect(config?.mode).toBe('direct')
      expect(config?.url).toBe(url)
    } finally {
      await orchestrator.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the hub proxy gateway', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-engine-'))
    const orchestrator = new EngineOrchestrator({
      transport: {
        fetchEngine: async () =>
          new Response(JSON.stringify({ workspace: '/workspace/project' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
      env: dataEnv(root),
    })
    try {
      await orchestrator.update({
        enabled: true,
        direct: ['http://127.0.0.1:1'],
        proxy: true,
        reachable: true,
        token: 'engine-token',
      })
      const config = readEngineConfig(dataEnv(root))
      expect(config?.mode).toBe('proxy')
      expect(config?.enabled).toBe(true)
      expect(config?.url).toBeDefined()
      expect(config?.token).toBeDefined()
      const response = await fetch(`${config!.url}/v1/config`, {
        headers: { authorization: `Bearer ${config!.token}` },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ workspace: '/workspace/project' })
      const rejected = await fetch(`${config!.url}/v1/config`)
      expect(rejected.status).toBe(401)
    } finally {
      await orchestrator.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
