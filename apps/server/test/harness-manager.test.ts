import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import { HarnessManager } from '../src/harness/manager.ts'
import { HarnessStore } from '../src/harness/store.ts'
import { HarnessUnconfiguredError } from '../src/harness/types.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let manager: HarnessManager
const servers: Server[] = []

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clara-harness-manager-'))
  db = openDatabase(join(dir, 'clara.db'))
  manager = new HarnessManager(
    new HarnessStore({
      db,
      key: await loadSecretKey(generateSecretKey()),
      keyVersion: 1,
    })
  )
  await manager.load()
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('harness manager', () => {
  it('starts unconfigured and returns a clear error', async () => {
    expect(manager.configured).toBe(false)
    expect((await manager.probe()).code).toBe('unconfigured')
    await expect(
      manager.request(
        { type: 'http.request', id: 'one', method: 'GET', path: '/api/info' },
        AbortSignal.timeout(1000)
      )
    ).rejects.toBeInstanceOf(HarnessUnconfiguredError)
  })

  it('swaps the active connection and proxies to it', async () => {
    const fake = await startFake()
    const changes: number[] = []
    manager.subscribe(() => {
      changes.push(manager.generation)
    })

    const connection = await manager.save({
      kind: 'opencode',
      label: 'Fake',
      baseUrl: fake.url,
      authType: 'basic',
      password: 'secret',
    })

    expect(connection.isActive).toBe(true)
    expect(manager.configured).toBe(true)
    expect((await manager.probe()).ok).toBe(true)
    const response = await manager.request(
      { type: 'http.request', id: 'one', method: 'GET', path: '/api/info' },
      AbortSignal.timeout(1000)
    )
    expect((await response.json()) as { version: string }).toMatchObject({ version: '9.9.9' })
    expect(changes.length).toBeGreaterThan(0)
    expect(await manager.redactionValues()).toContain('secret')
  })

  it('activates one connection and clears it on removal', async () => {
    const first = await manager.save({
      kind: 'opencode',
      label: 'First',
      baseUrl: 'http://first:4096',
      authType: 'none',
    })
    const second = await manager.save({
      kind: 'opencode',
      label: 'Second',
      baseUrl: 'http://second:4096',
      authType: 'none',
    })

    expect(manager.active?.id).toBe(first.id)
    await manager.activate(second.id)
    expect(manager.active?.id).toBe(second.id)
    await manager.remove(second.id)
    expect(manager.configured).toBe(false)
    expect(manager.active).toBeUndefined()
  })

  it('tests a candidate without saving it', async () => {
    const fake = await startFake()
    const result = await manager.test({
      kind: 'opencode',
      label: 'Candidate',
      baseUrl: fake.url,
      authType: 'none',
    })
    expect(result.ok).toBe(true)
    expect(manager.list()).toEqual([])
  })
})

async function startFake(): Promise<{ url: string }> {
  const server = createServer((request, response) => {
    if (request.url === '/api/info') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ version: '9.9.9' }))
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fake server address')
  return { url: `http://127.0.0.1:${address.port}` }
}
