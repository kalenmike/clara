import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKey, generateSecretKey, loadSecretKey } from '@clara/crypto'
import { HarnessManager } from '../src/harness/manager.ts'
import { HarnessMetadataStore } from '../src/harness/metadata.ts'
import { HarnessStore } from '../src/harness/store.ts'
import { HarnessUnconfiguredError } from '../src/harness/types.ts'
import { ProjectStore } from '../src/projects/store.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let manager: HarnessManager

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clara-harness-manager-'))
  db = openDatabase(join(dir, 'clara.db'))
  const key = await loadSecretKey(generateSecretKey())
  const projects = new ProjectStore(db)
  manager = new HarnessManager(
    new HarnessStore({ db, key, keyVersion: 1 }),
    new HarnessMetadataStore(db, projects),
    projects
  )
  await manager.load()
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

async function enroll(harnessId = 'harness-a', adapterId = 'adapter-a') {
  const pairing = await manager.createPairing({ kind: 'opencode', label: 'OpenCode' })
  return manager.enroll({
    pairId: pairing.id,
    pairToken: pairing.token,
    harnessId,
    kind: 'opencode',
    label: 'OpenCode',
    adapterId,
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

  it('promotes another harness when the active one is removed', async () => {
    const first = await enroll('harness-a', 'adapter-a')
    const second = await enroll('harness-b', 'adapter-b')
    expect(first.connection.isActive).toBe(true)
    expect(second.connection.isActive).toBe(false)

    await manager.remove(first.connection.id)

    expect(manager.configured).toBe(true)
    expect(manager.active?.harnessId).toBe('harness-b')
  })

  it('keeps every harness record linked to one workspace', async () => {
    await enroll()
    const project = manager.projects.create({ name: 'Demo' })
    const workspace = manager.projects.addWorkspace(project.id, {
      harnessID: 'harness-a',
      directory: '/workspace/demo',
    })
    for (const harnessProjectID of ['harness-project-a', 'harness-project-b']) {
      manager.projects.linkHarnessProject({
        harnessID: 'harness-a',
        harnessProjectID,
        projectID: project.id,
        workspaceID: workspace.id,
      })
    }
    expect(manager.harnessProjectIds(project.id)).toEqual([
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

  it('reads a host resource sample from a live adapter', async () => {
    await enroll()
    const metrics = {
      sampledAt: new Date(1_000).toISOString(),
      platform: 'linux',
      arch: 'x64',
      cpu: { cores: 2, hostCores: 4, usagePercent: 25, source: 'cgroup' as const },
      memory: {
        totalBytes: 4 * 1024 ** 3,
        freeBytes: 1024 ** 3,
        usedPercent: 75,
        source: 'cgroup' as const,
      },
      disks: [],
    }
    await manager.setLive(
      'harness-a',
      async (request) => {
        expect(new URL(request.url).pathname).toBe('/harness/v1/host')
        return Response.json(metrics)
      },
      'local'
    )

    await expect(manager.hostResources('harness-a')).resolves.toEqual({
      state: 'ok',
      metrics,
    })
  })

  it('treats a missing host route as unsupported', async () => {
    await enroll()
    await manager.setLive(
      'harness-a',
      async () => new Response('not found', { status: 404 }),
      'local'
    )

    await expect(manager.hostResources('harness-a')).resolves.toEqual({ state: 'unsupported' })
  })

  it('keeps a host sample failure non-fatal', async () => {
    await enroll()
    await expect(manager.hostResources('harness-a')).resolves.toEqual({ state: 'unavailable' })

    await manager.setLive('harness-a', async () => Response.json({ ok: true }), 'local')
    await expect(manager.hostResources('harness-a')).resolves.toEqual({ state: 'unavailable' })

    await manager.setLive('harness-a', () => new Promise(() => {}), 'local')
    await expect(manager.hostResources('harness-a', 25)).resolves.toEqual({ state: 'unavailable' })
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
