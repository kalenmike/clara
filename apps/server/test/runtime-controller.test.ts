import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentInfo } from '@clara/shared-types'
import type { ServerConfig } from '../src/config.ts'
import { OpenCodeClient } from '../src/opencode.ts'
import { AgentStoppedError, RuntimeController } from '../src/runtime/controller.ts'
import { closeDatabase, openDatabase } from '../src/store/database.ts'
import { SettingsStore } from '../src/store/settings.ts'

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
    opencode: { url: 'http://127.0.0.1:4096' },
    local: { host: '127.0.0.1', port },
    psk: 'test-psk',
    pairingBaseUrl: 'https://clara.example',
    configDir: dir,
    configPath: join(dir, 'server.json'),
    dbPath: join(dir, 'clara.db'),
    sources: {
      opencodeUrl: 'default',
      opencodePassword: 'none',
      localHost: 'default',
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

async function createController(port = 0): Promise<{
  controller: RuntimeController
  settings: SettingsStore
  close: () => Promise<void>
}> {
  const serverConfig = config(port)
  const db = openDatabase(serverConfig.dbPath)
  const settings = new SettingsStore(db)
  const controller = new RuntimeController({
    config: serverConfig,
    openCode: new OpenCodeClient('http://127.0.0.1:4096'),
    info,
    settings,
    log: () => undefined,
  })
  controllers.push(controller)
  return {
    controller,
    settings,
    close: async () => {
      await controller.close()
      closeDatabase(db)
    },
  }
}

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
