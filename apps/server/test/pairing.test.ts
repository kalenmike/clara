import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKey } from '@clara/crypto'
import { loadConfig, type ServerConfig } from '../src/config.ts'
import { createPairingPayload, pairingLinkBase, printPairing } from '../src/pairing.ts'
import type { DeviceStore } from '../src/store/devices.ts'

const tempDirs: string[] = []
const ENV_KEYS = [
  'CLARA_CONFIG_DIR',
  'CLARA_DB_PATH',
  'CLARA_LOCAL_HOST',
  'CLARA_LOCAL_PORT',
  'CLARA_RELAY_URL',
  'CLARA_RELAY_ROOM',
  'CLARA_AGENT_TOKEN',
  'CLARA_CLIENT_TOKEN',
  'CLARA_PAIRING_BASE_URL',
  'CLARA_WEB_PORT',
  'XDG_STATE_HOME',
] as const

let savedEnv: Record<string, string | undefined> = {}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-pairing-'))
  tempDirs.push(dir)
  return dir
}

function fakeDevices(): DeviceStore {
  return {
    createPairingToken: async () => ({
      id: 'enroll-id',
      token: generateKey(),
      fingerprint: 'fingerprint',
      expiresAt: Date.now() + 600_000,
    }),
  } as DeviceStore
}

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
    pairingBaseUrl: 'https://clara.example',
    configDir: '/tmp/clara-pairing',
    configPath: '/tmp/clara-pairing/server.json',
    dataDir: '/tmp/clara-pairing',
    dbPath: '/tmp/clara-pairing/clara.db',
    sources: {
      localHost: 'default',
      localBindHost: 'default',
      localPort: 'default',
      relayUrl: 'none',
      relayRoom: 'none',
      agentToken: 'none',
      clientToken: 'none',
      pairingBaseUrl: 'default',
    },
    ...overrides,
  }
}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('createPairingPayload', () => {
  it('pairs with the advertised host, not the container bind address', async () => {
    const payload = await createPairingPayload(
      baseConfig({ local: { host: '127.0.0.1', bindHost: '0.0.0.0', port: 8788 } }),
      fakeDevices()
    )

    expect(payload.wsUrl).toBe('ws://127.0.0.1:8788/ws')
  })

  it('uses the local listener when no relay is configured', async () => {
    const payload = await createPairingPayload(baseConfig(), fakeDevices())

    expect(payload).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      clientToken: 'local',
    })
  })

  it('uses the relay room when a relay is configured', async () => {
    const payload = await createPairingPayload(
      baseConfig({
        relay: {
          url: 'wss://relay.example',
          room: 'room-1',
          agentToken: 'agent',
          clientToken: 'client',
        },
      }),
      fakeDevices()
    )

    expect(payload).toMatchObject({
      wsUrl: 'wss://relay.example/room/room-1',
      room: 'room-1',
      clientToken: 'client',
    })
  })
})

describe('pairingLinkBase', () => {
  it('uses the configured base by default', () => {
    expect(pairingLinkBase('https://clara.example', '127.0.0.1')).toBe('https://clara.example')
  })

  it('keeps a loopback configured base for --no-relay', () => {
    expect(pairingLinkBase('http://localhost:5173', '127.0.0.1', { noRelay: true })).toBe(
      'http://localhost:5173'
    )
  })

  it('prints the local web app for --no-relay when the base is remote', () => {
    expect(pairingLinkBase('https://clara.example', '127.0.0.1', { noRelay: true })).toBe(
      'http://127.0.0.1:8080'
    )
  })

  it('formats an IPv6 local host', () => {
    expect(pairingLinkBase('https://clara.example', '::1', { noRelay: true })).toBe(
      'http://[::1]:8080'
    )
  })

  it('uses CLARA_WEB_PORT for the local fallback', () => {
    process.env.CLARA_WEB_PORT = '9090'
    expect(pairingLinkBase('https://clara.example', '127.0.0.1', { noRelay: true })).toBe(
      'http://127.0.0.1:9090'
    )
  })
})

describe('pair command configuration', () => {
  it('reads the panel web URL from server.json', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({
        pairingBaseUrl: 'https://saved.example',
        relay: { url: 'wss://relay.example', room: 'room-1' },
      }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const config = loadConfig()
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      await printPairing(config, fakeDevices(), false)
    } finally {
      spy.mockRestore()
    }

    expect(logs.join('\n')).toContain('https://saved.example/#pair=')
  })

  it('keeps the configured Web URL for a local code without --no-relay', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      await printPairing(baseConfig(), fakeDevices(), false)
    } finally {
      spy.mockRestore()
    }

    expect(logs.join('\n')).toContain('https://clara.example/#pair=')
  })

  it('uses the local web app and names --no-relay', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      await printPairing(baseConfig(), fakeDevices(), false, { noRelay: true })
    } finally {
      spy.mockRestore()
    }

    expect(logs.join('\n')).toContain('http://127.0.0.1:8080/#pair=')
    expect(logs.join('\n')).toContain('bypassed by --no-relay')
  })
})

describe('loadConfig no-relay pairing', () => {
  it('drops the relay so a local code needs no relay tokens', async () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'wss://relay.example'
    process.env.CLARA_RELAY_ROOM = 'room-1'

    expect(() => loadConfig()).toThrow(/Missing CLARA_AGENT_TOKEN and CLARA_CLIENT_TOKEN/)

    const config = loadConfig({ noRelay: true })
    expect(config.relay).toBeUndefined()
    expect(config.sources.relayUrl).toBe('none')

    const payload = await createPairingPayload(config, fakeDevices())
    expect(payload).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      clientToken: 'local',
      enrollId: 'enroll-id',
    })
  })
})
