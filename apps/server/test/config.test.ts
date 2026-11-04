import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generatePsk } from '@clara/crypto'
import { loadConfig } from '../src/config.ts'

const tempDirs: string[] = []
const ENV_KEYS = [
  'CLARA_CONFIG_DIR',
  'CLARA_DATA_DIR',
  'CLARA_DB_PATH',
  'CLARA_OPENCODE_URL',
  'CLARA_OPENCODE_PASSWORD',
  'CLARA_LOCAL_HOST',
  'CLARA_LOCAL_PORT',
  'CLARA_RELAY_URL',
  'CLARA_RELAY_ROOM',
  'CLARA_AGENT_TOKEN',
  'CLARA_CLIENT_TOKEN',
  'CLARA_PSK',
  'CLARA_PAIRING_BASE_URL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const

let savedEnv: Record<string, string | undefined> = {}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-config-'))
  tempDirs.push(dir)
  return dir
}

function cleanEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  cleanEnv()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadConfig sources', () => {
  it('reports defaults when neither the environment nor the file set a value', () => {
    const dir = tempDir()
    const dataHome = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_DATA_HOME = dataHome
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig()

    expect(config.opencode.url).toBe('http://127.0.0.1:4096')
    expect(config.local).toEqual({ host: '127.0.0.1', port: 8788 })
    expect(config.relay).toBeUndefined()
    expect(config.sources.opencodeUrl).toBe('default')
    expect(config.sources.opencodePassword).toBe('none')
    expect(config.sources.localHost).toBe('default')
    expect(config.sources.localPort).toBe('default')
    expect(config.sources.relayUrl).toBe('none')
    expect(config.sources.pairingBaseUrl).toBe('default')
    expect(config.sources.psk).toBe('generated')
    expect(config.dataDir).toBe(join(dataHome, 'clara'))
    expect(config.dbPath).toBe(join(dataHome, 'clara', 'clara.db'))
    expect(config.ledgerDbPath).toBe(join(dataHome, 'clara', 'ledger.db'))
  })

  it('honours XDG_CONFIG_HOME and XDG_DATA_HOME', () => {
    const configHome = tempDir()
    const dataHome = tempDir()
    process.env.XDG_CONFIG_HOME = configHome
    process.env.XDG_DATA_HOME = dataHome
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig()

    expect(config.configDir).toBe(join(configHome, 'clara'))
    expect(config.configPath).toBe(join(configHome, 'clara', 'server.json'))
    expect(config.dataDir).toBe(join(dataHome, 'clara'))
  })

  it('allows CLARA_DATA_DIR to move database defaults', () => {
    const dir = tempDir()
    const dataDir = join(dir, 'data')
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dataDir
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig()

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbPath).toBe(join(dataDir, 'clara.db'))
    expect(config.ledgerDbPath).toBe(join(dataDir, 'ledger.db'))
  })

  it('allows CLARA_DB_PATH to move the database', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.CLARA_DB_PATH = join(dir, 'custom', 'agent.sqlite')
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig()
    expect(config.dbPath).toBe(join(dir, 'custom', 'agent.sqlite'))
  })

  it('tracks file values and environment overrides independently', () => {
    const dir = tempDir()
    const psk = generatePsk()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({
        opencode: { url: 'http://from-file:4096', password: 'file-password' },
        local: { host: '0.0.0.0', port: 9000 },
        relay: { url: 'https://relay.example', room: 'file-room' },
        psk,
        pairingBaseUrl: 'https://pair.example',
      }),
      { mode: 0o600 }
    )

    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_OPENCODE_URL = 'http://from-env:4096'
    process.env.CLARA_RELAY_ROOM = 'env-room'
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const config = loadConfig()

    expect(config.opencode.url).toBe('http://from-env:4096')
    expect(config.opencode.password).toBe('file-password')
    expect(config.local).toEqual({ host: '0.0.0.0', port: 9000 })
    expect(config.relay?.url).toBe('wss://relay.example')
    expect(config.relay?.room).toBe('env-room')
    expect(config.sources).toMatchObject({
      opencodeUrl: 'env',
      opencodePassword: 'file',
      localHost: 'file',
      localPort: 'file',
      relayUrl: 'file',
      relayRoom: 'env',
      agentToken: 'env',
      clientToken: 'env',
      psk: 'file',
      pairingBaseUrl: 'file',
    })
  })

  it('records a generated relay room when the file only has the relay URL', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ relay: { url: 'wss://relay.example' } }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const config = loadConfig()

    expect(config.relay?.room).toBeTruthy()
    expect(config.sources.relayUrl).toBe('file')
    expect(config.sources.relayRoom).toBe('generated')
  })

  it('marks a rotated pairing key as generated', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig({ rotate: true })

    expect(config.sources.psk).toBe('generated')
    expect(config.psk).toHaveLength(43)
  })
})
