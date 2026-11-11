import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect(manager.configured).toBe(true)
    expect((await manager.probe()).code).toBe('offline')
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
})
