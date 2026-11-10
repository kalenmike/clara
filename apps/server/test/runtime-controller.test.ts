import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@clara/shared-types'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import type { ServerConfig } from '../src/config.ts'
import { HarnessManager } from '../src/harness/manager.ts'
import { HarnessStore } from '../src/harness/store.ts'
import { AgentStoppedError, RuntimeController } from '../src/runtime/controller.ts'
import { closeDatabase, openDatabase } from '../src/store/database.ts'
import { SettingsStore } from '../src/store/settings.ts'
import type { PanelOrchestrationControl } from '@clara/shared-types'

const orchestration = vi.hoisted(() => ({
  read: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../src/orchestration/service.ts', () => ({
  readOrchestrationControl: orchestration.read,
  startOrchestration: orchestration.start,
  stopOrchestration: orchestration.stop,
}))

function stoppedControl(desired = false, error?: string): PanelOrchestrationControl {
  return {
    desired,
    effective: false,
    state: 'stopped',
    url: 'http://127.0.0.1:8789',
    ...(error ? { error } : {}),
  }
}

const tempDirs: string[] = []
const controllers: RuntimeController[] = []
const servers: Server[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-controller-'))
  tempDirs.push(dir)
  return dir
}

function config(port: number): ServerConfig {
  const dir = tempDir()
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port },
    psk: 'test-psk',
    pairingBaseUrl: 'https://clara.example',
    configDir: dir,
    configPath: join(dir, 'server.json'),
    dataDir: dir,
    dbPath: join(dir, 'clara.db'),
    sources: {
      localHost: 'default',
      localBindHost: 'default',
      localPort: 'default',
      relayUrl: 'none',
      relayRoom: 'none',
      agentToken: 'none',
      clientToken: 'none',
      psk: 'env',
      pairingBaseUrl: 'default',
    },
  }
}

const info: AgentInfo = { version: 'test', protocol: 1 }

async function createController(
  port = 0,
  options: { openCodeUrl?: string } = {}
): Promise<{
  controller: RuntimeController
  settings: SettingsStore
  info: AgentInfo
  close: () => Promise<void>
}> {
  const serverConfig = config(port)
  const db = openDatabase(serverConfig.dbPath)
  const settings = new SettingsStore(db)
  const controllerInfo: AgentInfo = { ...info }
  const harnessStore = new HarnessStore({
    db,
    key: await loadSecretKey(generateSecretKey()),
    keyVersion: 1,
  })
  await harnessStore.save({
    kind: 'opencode',
    label: 'Test OpenCode',
    baseUrl: options.openCodeUrl ?? 'http://127.0.0.1:4096',
    authType: 'none',
  })
  const harness = new HarnessManager(harnessStore)
  await harness.load()
  const controller = new RuntimeController({
    config: serverConfig,
    harness,
    info: controllerInfo,
    settings,
    log: () => undefined,
  })
  controllers.push(controller)
  return {
    controller,
    settings,
    info: controllerInfo,
    close: async () => {
      await controller.close()
      closeDatabase(db)
    },
  }
}

beforeEach(() => {
  orchestration.read.mockImplementation(async (desired: boolean, error?: string) =>
    stoppedControl(desired, error)
  )
  orchestration.start.mockResolvedValue(undefined)
  orchestration.stop.mockResolvedValue(undefined)
})

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.close()
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('RuntimeController', () => {
  it('starts desired transports and reports effective state', async () => {
    const { controller, close } = await createController()
    await controller.start()
    try {
      const controls = controller.controls()
      expect(controls.stopped).toBe(false)
      expect(controller.canProxy()).toBe(true)
      expect(controls.features.find((entry) => entry.name === 'opencode')).toMatchObject({
        configured: true,
        desired: true,
        effective: true,
      })
      expect(controls.features.find((entry) => entry.name === 'local')).toMatchObject({
        desired: true,
        effective: true,
      })
    } finally {
      await close()
    }
  })

  it('applies a shell policy to the next request', async () => {
    const { controller, settings, close } = await createController()
    await controller.start()
    try {
      expect(controller.controls().shell).toEqual({ mode: 'off', commands: [], blocked: 0 })

      const controls = await controller.setShellPolicy({
        mode: 'allowlist',
        commands: ['git log'],
      })
      expect(controls.shell).toEqual({
        mode: 'allowlist',
        commands: ['git log'],
        blocked: 0,
      })
      expect(controller.shellPolicy()).toEqual({
        mode: 'allowlist',
        commands: ['git log'],
      })
      expect(settings.getShellPolicy()).toEqual({
        mode: 'allowlist',
        commands: ['git log'],
      })
    } finally {
      await close()
    }
  })

  it('toggles traffic monitoring without stopping the agent', async () => {
    const { controller, settings, close } = await createController()
    await controller.start()
    try {
      expect(controller.controls().monitoring).toEqual({ enabled: true })
      expect(controller.traffic.enabled).toBe(true)

      await controller.setMonitoring(false)
      expect(settings.getMonitoring()).toBe(false)
      expect(controller.traffic.enabled).toBe(false)
      expect(controller.controls().monitoring).toEqual({ enabled: false })

      await controller.setStopped(true)
      await controller.setMonitoring(true)
      expect(controller.controls().monitoring).toEqual({ enabled: true })
      expect(controller.traffic.enabled).toBe(true)
    } finally {
      await close()
    }
  })

  it('persists and broadcasts the client sync gate and interval', async () => {
    const { controller, settings, info, close } = await createController()
    await controller.start()
    try {
      expect(controller.controls().sync).toEqual({ enabled: true, intervalMs: 30_000 })

      await controller.setSync({ enabled: false, intervalMs: 5_000 })
      expect(settings.getSync()).toEqual({ enabled: false, intervalMs: 5_000 })
      expect(controller.controls().sync).toEqual({ enabled: false, intervalMs: 5_000 })
      expect(info).toMatchObject({ syncEnabled: false, syncIntervalMs: 5_000 })
    } finally {
      await close()
    }
  })

  it('stops and restarts the local listener without losing its socket set', async () => {
    const { controller, close } = await createController()
    await controller.start()
    try {
      expect(
        controller.controls().features.find((entry) => entry.name === 'local')?.effective
      ).toBe(true)
      await controller.setFeature('local', false)
      expect(controller.controls().features.find((entry) => entry.name === 'local')).toMatchObject({
        desired: false,
        effective: false,
      })

      await controller.setFeature('local', true)
      expect(controller.controls().features.find((entry) => entry.name === 'local')).toMatchObject({
        desired: true,
        effective: true,
      })
    } finally {
      await close()
    }
  })

  it('stops every transport without overwriting the desired values', async () => {
    const { controller, settings, close } = await createController()
    await controller.start()
    try {
      await controller.setFeature('local', false)
      await controller.setFeature('push', false)

      const stopped = await controller.setStopped(true)
      expect(stopped.stopped).toBe(true)
      expect(stopped.features.every((entry) => entry.effective === false)).toBe(true)
      expect(controller.canProxy()).toBe(false)
      expect(settings.getFeature('local')).toBe(false)
      expect(settings.getFeature('push')).toBe(false)

      await expect(controller.setFeature('relay', true)).rejects.toBeInstanceOf(AgentStoppedError)

      const started = await controller.setStopped(false)
      expect(started.stopped).toBe(false)
      expect(started.features.find((entry) => entry.name === 'opencode')?.effective).toBe(true)
      expect(started.features.find((entry) => entry.name === 'local')).toMatchObject({
        desired: false,
        effective: false,
      })
      expect(settings.getFeature('local')).toBe(false)
    } finally {
      await close()
    }
  })

  it('persists a desired value and reports an error when the listener cannot start', async () => {
    const blocker = createServer()
    servers.push(blocker)
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const address = blocker.address()
    if (!address || typeof address === 'string') throw new Error('No port for the blocker')

    const { controller, settings, close } = await createController(address.port)
    await controller.start()
    try {
      const local = controller.controls().features.find((entry) => entry.name === 'local')
      expect(local).toMatchObject({ desired: true, effective: false })
      expect(local?.error).toMatch(/in use|EADDRINUSE/i)
      expect(settings.getFeature('local')).toBe(true)
    } finally {
      await close()
    }
  })

  it('starts and stops orchestration and broadcasts the effective flag', async () => {
    orchestration.read.mockImplementation(async (desired: boolean) => ({
      desired,
      effective: desired,
      state: desired ? 'local' : 'stopped',
      url: 'http://127.0.0.1:8789',
    }))
    const { controller, settings, info, close } = await createController()
    await controller.start()
    try {
      const controls = await controller.setOrchestration(true)
      expect(orchestration.start).toHaveBeenCalledOnce()
      expect(settings.getOrchestration()).toBe(true)
      expect(info.orchestration).toBe(true)
      expect(controls.orchestration).toMatchObject({ desired: true, effective: true })

      const stopped = await controller.setOrchestration(false)
      expect(orchestration.stop).toHaveBeenCalledOnce()
      expect(settings.getOrchestration()).toBe(false)
      expect(info.orchestration).toBe(false)
      expect(stopped.orchestration).toMatchObject({ desired: false, effective: false })
    } finally {
      await close()
    }
  })

  it('keeps orchestration enabled when an external instance cannot be stopped', async () => {
    orchestration.read.mockImplementation(async (desired: boolean) => ({
      desired,
      effective: true,
      state: 'external',
      url: 'http://127.0.0.1:8789',
    }))
    orchestration.stop.mockRejectedValue(
      Object.assign(new Error('started outside this data directory'), {
        status: 409,
        code: 'orchestrator_external',
      })
    )
    const { controller, settings, close } = await createController()
    settings.setOrchestration(true)
    await controller.start()
    try {
      await expect(controller.setOrchestration(false)).rejects.toThrow(
        'started outside this data directory'
      )
      expect(settings.getOrchestration()).toBe(true)
    } finally {
      await close()
    }
  })

  it('only starts the panel and database when the stored state is stopped', async () => {
    const { controller, settings, close } = await createController()
    settings.setStopped(true)
    await controller.start()
    try {
      const controls = controller.controls()
      expect(controls.stopped).toBe(true)
      expect(controls.features.every((entry) => entry.effective === false)).toBe(true)
      expect(controller.canProxy()).toBe(false)
    } finally {
      await close()
    }
  })
})
