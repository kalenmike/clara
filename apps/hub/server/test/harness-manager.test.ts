import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClaraProject } from '@clara/api-contract'
import { generateKey, generateSecretKey, loadSecretKey } from '@clara/crypto'
import { HarnessManager } from '../src/harness/manager.ts'
import { HarnessMetadataStore } from '../src/harness/metadata.ts'
import { HarnessStore } from '../src/harness/store.ts'
import { HarnessUnconfiguredError } from '../src/harness/types.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let manager: HarnessManager

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clara-harness-manager-'))
  db = openDatabase(join(dir, 'clara.db'))
  const key = await loadSecretKey(generateSecretKey())
  manager = new HarnessManager(
    new HarnessStore({ db, key, keyVersion: 1 }),
    new HarnessMetadataStore(db)
  )
  await manager.load()
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

async function enroll() {
  const pairing = await manager.createPairing({ kind: 'opencode', label: 'OpenCode' })
  return manager.enroll({
    pairId: pairing.id,
    pairToken: pairing.token,
    harnessId: 'harness-a',
    kind: 'opencode',
    label: 'OpenCode',
    adapterId: 'adapter-a',
    key: generateKey(),
    adapterVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: {},
    transport: 'local',
  })
}

describe('harness manager', () => {
  it('starts unconfigured and returns a clear error', async () => {
    expect(manager.configured).toBe(false)
    expect((await manager.probe()).code).toBe('unconfigured')
    await expect(
      manager.request({ method: 'GET', path: '/info' }, AbortSignal.timeout(1000))
    ).rejects.toBeInstanceOf(HarnessUnconfiguredError)
  })

  it('marks an enrolled adapter offline until its session registers', async () => {
    const result = await enroll()
    expect(result.connection.isActive).toBe(true)
    expect(result.connection.online).toBe(false)
    expect(manager.configured).toBe(true)
    expect((await manager.probe()).code).toBe('offline')

    await manager.setLive('harness-a', async () => Response.json({ protocol: 1 }), 'local')
    expect(manager.active?.online).toBe(true)
    await manager.clearLive('harness-a')
    expect(manager.active?.online).toBe(false)
  })

  it('keeps every harness record linked to one canonical directory', async () => {
    await enroll()
    const project = (id: string, canonical: string): ClaraProject => ({
      id,
      canonical,
      time: { created: 1, updated: 2, active: 3 },
      sandboxes: [],
    })
    const [first] = manager.overlayProjectList([
      project('harness-project-a', '/workspace/demo'),
      project('harness-project-b', '/workspace/demo'),
    ])
    const target = first?.id
    expect(target).toBeDefined()
    expect(manager.harnessProjectIds(target ?? '')).toEqual([
      'harness-project-a',
      'harness-project-b',
    ])
  })

  it('reports the live harness from the health route', async () => {
    await enroll()
    await manager.setLive(
      'harness-a',
      async (request) => {
        expect(new URL(request.url).pathname).toBe('/harness/v1/health')
        return Response.json({
          ok: true,
          code: 'ok',
          version: '2.1.1',
          latencyMs: 7,
        })
      },
      'local'
    )

    await expect(manager.probe()).resolves.toMatchObject({
      ok: true,
      code: 'ok',
      version: '2.1.1',
      latencyMs: 7,
    })
  })

  it('proxies through a live adapter session', async () => {
    await enroll()
    await manager.setLive(
      'harness-a',
      async (request) => {
        expect(new URL(request.url).pathname).toBe('/harness/v1/sessions')
        return Response.json({ data: [], cursor: {} })
      },
      'local'
    )

    const response = await manager.request(
      { method: 'GET', path: '/sessions' },
      AbortSignal.timeout(1000)
    )
    expect((await response.json()) as { data: unknown[] }).toEqual({ data: [], cursor: {} })
    expect((await manager.probe()).ok).toBe(false)
  })

  it('times out a probe even when the adapter ignores the abort signal', async () => {
    await enroll()
    await manager.setLive('harness-a', () => new Promise(() => {}), 'local')

    const probe = await manager.probe(25)
    expect(probe.code).toBe('timeout')
    expect(probe.ok).toBe(false)
  })
})
