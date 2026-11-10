import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generatePsk } from '@clara/crypto'
import { loadConfig, type ServerConfig } from '../src/config.ts'
import { createPairingPayload, pairingLinkBase } from '../src/pairing.ts'

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
  'CLARA_PSK',
  'CLARA_PAIRING_BASE_URL',
  'XDG_STATE_HOME',
] as const

let savedEnv: Record<string, string | undefined> = {}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-pairing-'))
  tempDirs.push(dir)
  return dir
}

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
    psk: generatePsk(),
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
      psk: 'generated',
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
      baseConfig({ local: { host: '127.0.0.1', bindHost: '0.0.0.0', port: 8788 } })
    )

    expect(payload.wsUrl).toBe('ws://127.0.0.1:8788/ws')
  })

  it('uses the local listener when no relay is configured', async () => {
    const payload = await createPairingPayload(baseConfig())

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
      })
    )

    expect(payload).toMatchObject({
      wsUrl: 'wss://relay.example/room/room-1',
      room: 'room-1',
      clientToken: 'client',
    })
  })
})

describe('pairingLinkBase', () => {
  it('uses the configured base for relay payloads', () => {
    expect(pairingLinkBase({ room: 'room-1' }, 'https://clara.example', '127.0.0.1')).toBe(
      'https://clara.example'
    )
  })

  it('keeps a loopback configured base for local payloads', () => {
    expect(pairingLinkBase({ room: 'local' }, 'http://localhost:5173', '127.0.0.1')).toBe(
      'http://localhost:5173'
    )
  })

  it('prints the local web app for local payloads when the base is remote', () => {
    expect(pairingLinkBase({ room: 'local' }, 'https://clara.example', '127.0.0.1')).toBe(
      'http://127.0.0.1:8080'
    )
  })

  it('formats an IPv6 local host', () => {
    expect(pairingLinkBase({ room: 'local' }, 'https://clara.example', '::1')).toBe(
      'http://[::1]:8080'
    )
  })
})

describe('loadConfig local pairing', () => {
  it('drops the relay so a local code needs no relay tokens', async () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'wss://relay.example'
    process.env.CLARA_RELAY_ROOM = 'room-1'

    expect(() => loadConfig()).toThrow(/Missing CLARA_AGENT_TOKEN and CLARA_CLIENT_TOKEN/)

    const config = loadConfig({ local: true })
    expect(config.relay).toBeUndefined()
    expect(config.sources.relayUrl).toBe('none')

    const payload = await createPairingPayload(config)
    expect(payload).toMatchObject({
      wsUrl: 'ws://127.0.0.1:8788/ws',
      room: 'local',
      clientToken: 'local',
      psk: config.psk,
    })
  })
})
