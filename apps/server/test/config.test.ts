import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generatePsk } from '@clara/crypto'
import { loadConfig, savePairingBaseUrl } from '../src/config.ts'

const tempDirs: string[] = []
const ENV_KEYS = [
  'CLARA_CONFIG_DIR',
  'CLARA_DATA_DIR',
  'CLARA_DB_PATH',
  'CLARA_LOCAL_HOST',
  'CLARA_LOCAL_BIND_HOST',
  'CLARA_LOCAL_PORT',
  'CLARA_RELAY_URL',
  'CLARA_RELAY_ROOM',
  'CLARA_AGENT_TOKEN',
  'CLARA_CLIENT_TOKEN',
  'CLARA_PSK',
  'CLARA_PAIRING_BASE_URL',
  'CLARA_WEB_PORT',
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

    expect(config.local).toEqual({ host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 })
    expect(config.relay).toBeUndefined()
    expect(config.sources.localHost).toBe('default')
    expect(config.sources.localBindHost).toBe('default')
    expect(config.sources.localPort).toBe('default')
    expect(config.sources.relayUrl).toBe('none')
    expect(config.sources.pairingBaseUrl).toBe('default')
    expect(config.pairingBaseUrl).toBe('http://127.0.0.1:8080')
    expect(config.sources.psk).toBe('generated')
    expect(config.dataDir).toBe(join(dataHome, 'clara'))
    expect(config.dbPath).toBe(join(dataHome, 'clara', 'clara.db'))
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
    process.env.CLARA_RELAY_ROOM = 'env-room'
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const config = loadConfig()

    expect(config.local).toEqual({ host: '0.0.0.0', bindHost: '0.0.0.0', port: 9000 })
    expect(config.relay?.url).toBe('wss://relay.example')
    expect(config.relay?.room).toBe('env-room')
    expect(config.sources).toMatchObject({
      localHost: 'file',
      localBindHost: 'file',
      localPort: 'file',
      relayUrl: 'file',
      relayRoom: 'env',
      agentToken: 'env',
      clientToken: 'env',
      psk: 'file',
      pairingBaseUrl: 'file',
    })
  })

  it('separates the advertised local host from the listener address', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.CLARA_LOCAL_HOST = '127.0.0.1'
    process.env.CLARA_LOCAL_BIND_HOST = '0.0.0.0'

    const config = loadConfig()

    expect(config.local).toEqual({ host: '127.0.0.1', bindHost: '0.0.0.0', port: 8788 })
    expect(config.sources.localBindHost).toBe('env')
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

  it('treats empty relay environment values as unset', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ relay: { url: 'wss://relay.example', room: 'file-room' } }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    // This is what docker/server.compose.yml passes when a value is optional.
    process.env.CLARA_RELAY_URL = ''
    process.env.CLARA_RELAY_ROOM = ''
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const first = loadConfig()
    const second = loadConfig()

    expect(first.relay?.url).toBe('wss://relay.example')
    expect(first.relay?.room).toBe('file-room')
    expect(second.relay?.room).toBe('file-room')
    expect(first.sources).toMatchObject({
      relayUrl: 'file',
      relayRoom: 'file',
      agentToken: 'env',
      clientToken: 'env',
    })
  })

  it('generates and persists one relay room when only the URL is set', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'https://relay.example'
    process.env.CLARA_RELAY_ROOM = ''
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const first = loadConfig()
    const second = loadConfig()

    expect(first.relay?.room).toBeTruthy()
    expect(first.sources.relayRoom).toBe('generated')
    expect(second.relay?.room).toBe(first.relay?.room)
    expect(second.sources.relayRoom).toBe('file')
  })

  it('persists a relay URL override without changing the room', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ relay: { url: 'wss://old.example', room: 'file-room' } }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'https://new.example'
    process.env.CLARA_AGENT_TOKEN = 'agent-token'
    process.env.CLARA_CLIENT_TOKEN = 'client-token'

    const config = loadConfig()
    const saved = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'))

    expect(config.relay?.url).toBe('wss://new.example')
    expect(config.relay?.room).toBe('file-room')
    expect(saved.relay).toEqual({ url: 'wss://new.example', room: 'file-room' })
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

  it('uses CLARA_WEB_PORT for the default web URL', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_WEB_PORT = '9090'

    const config = loadConfig()

    expect(config.pairingBaseUrl).toBe('http://127.0.0.1:9090')
    expect(config.sources.pairingBaseUrl).toBe('default')
  })

  it('falls back to port 8080 for an invalid CLARA_WEB_PORT', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_WEB_PORT = 'not-a-port'

    expect(loadConfig().pairingBaseUrl).toBe('http://127.0.0.1:8080')
  })

  it('does not write the default web URL to server.json', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()

    loadConfig()
    const saved = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'))

    expect(saved.pairingBaseUrl).toBeUndefined()
  })

  it('treats an empty pairing base environment value as unset', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ pairingBaseUrl: 'https://file.example' }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_PAIRING_BASE_URL = ''

    const config = loadConfig()

    expect(config.pairingBaseUrl).toBe('https://file.example')
    expect(config.sources.pairingBaseUrl).toBe('file')
  })

  it('lets CLARA_PAIRING_BASE_URL win over server.json', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({ pairingBaseUrl: 'https://file.example' }),
      { mode: 0o600 }
    )
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_PAIRING_BASE_URL = 'https://env.example/'

    const config = loadConfig()

    expect(config.pairingBaseUrl).toBe('https://env.example')
    expect(config.sources.pairingBaseUrl).toBe('env')
  })

  it('rejects an invalid pairing base URL', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_PAIRING_BASE_URL = 'ftp://example.com'

    expect(() => loadConfig()).toThrow(/Invalid pairing Web URL/)
  })
})

describe('savePairingBaseUrl', () => {
  it('writes the value and preserves other fields', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    const psk = generatePsk()
    writeFileSync(
      path,
      JSON.stringify({
        local: { host: '0.0.0.0', port: 9000 },
        psk,
        relay: { url: 'wss://relay.example', room: 'room-1' },
        opencode: { url: 'http://old' },
      }),
      { mode: 0o600 }
    )

    savePairingBaseUrl(path, 'https://clara.example/')
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.pairingBaseUrl).toBe('https://clara.example')
    expect(saved.local).toEqual({ host: '0.0.0.0', port: 9000 })
    expect(saved.psk).toBe(psk)
    expect(saved.relay).toEqual({ url: 'wss://relay.example', room: 'room-1' })
    expect(saved.opencode).toBeUndefined()
  })

  it('removes the value when cleared', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(
      path,
      JSON.stringify({ pairingBaseUrl: 'https://clara.example', psk: generatePsk() }),
      { mode: 0o600 }
    )

    savePairingBaseUrl(path, undefined)
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.pairingBaseUrl).toBeUndefined()
  })
})
