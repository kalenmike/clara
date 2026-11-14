import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKey } from '@clara/crypto'
import { verifyRelayGrant } from '@clara/shared-types'
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
    })
    expect(payload.grant).toBeUndefined()
  })

  it('uses the relay room and enrollment grant when a relay is configured', async () => {
    const payload = await createPairingPayload(
      baseConfig({
        relay: {
          url: 'wss://relay.example',
          room: 'room-1',
          agentToken: 'agent',
        },
      }),
      fakeDevices()
    )

    expect(payload).toMatchObject({
      wsUrl: 'wss://relay.example/room/room-1',
      room: 'room-1',
    })
    expect(payload.grant).toBeDefined()
  })

  it('carries a one-time enrollment grant scoped to the pairing id', async () => {
    const payload = await createPairingPayload(
      baseConfig({
        relay: {
          url: 'wss://relay.example',
          room: 'room-1',
          agentToken: 'agent-token',
        },
      }),
      fakeDevices()
    )

    expect(payload.grant).toBeDefined()
    const verified = await verifyRelayGrant(payload.grant!, {
      agentToken: 'agent-token',
      room: 'room-1',
    })
    expect(verified).toEqual({
      ok: true,
      payload: expect.objectContaining({ room: 'room-1', role: 'client', id: 'enroll-id' }),
    })
    // The enrollment grant is short-lived and must not outlive the code by much.
    const expiresAt = verified.ok ? verified.payload.exp * 1000 : 0
    expect(expiresAt - payload.expiresAt).toBeLessThanOrEqual(60_000)
  })

  it('ignores a configured relay for a local-only panel code', async () => {
    const payload = await createPairingPayload(
      baseConfig({
        relay: {
          url: 'wss://relay.example',
          room: 'room-1',
          agentToken: 'agent',
        },
      }),
      fakeDevices(),
      { noRelay: true }
    )

    expect(payload).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
    })
    expect(payload.grant).toBeUndefined()
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

describe('pairing with an incomplete relay', () => {
  it('falls back to a local code without relay tokens', async () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'wss://relay.example'
    process.env.CLARA_RELAY_ROOM = 'room-1'

    const config = loadConfig()
    expect(config.relay?.agentToken).toBe('')
    const incomplete = await createPairingPayload(config, fakeDevices())
    expect(incomplete).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      enrollId: 'enroll-id',
    })

    const local = loadConfig({ noRelay: true })
    expect(local.relay).toBeUndefined()
    expect(local.sources.relayUrl).toBe('none')

    const payload = await createPairingPayload(local, fakeDevices())
    expect(payload).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      enrollId: 'enroll-id',
    })
  })

  it('uses a local link and warns when the relay hub token is missing', async () => {
    const config = baseConfig({
      relay: { url: 'wss://relay.example', room: 'room-1', agentToken: '' },
    })
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      await printPairing(config, fakeDevices(), false)
    } finally {
      spy.mockRestore()
    }

    expect(logs.join('\n')).toContain('http://127.0.0.1:8080/#pair=')
    expect(logs.join('\n')).toContain('the hub token is missing')
  })
})
