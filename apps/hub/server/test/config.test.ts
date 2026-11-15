import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyRelayCredentials,
  loadConfig,
  readRelayTarget,
  saveLocalAccess,
  savePairingBaseUrl,
  saveRelayRoom,
  saveRelayTarget,
  validateRelayConfig,
  type ServerConfig,
} from '../src/config.ts'

const AGENT_TOKEN = 'a'.repeat(43)
const TOKEN_FORMAT_ERROR =
  'The relay token must be at least 32 characters with no spaces or commas. Use the generated value or `openssl rand -base64 32`.'

const tempDirs: string[] = []
const ENV_KEYS = [
  'CLARA_CONFIG_DIR',
  'CLARA_DATA_DIR',
  'CLARA_DB_PATH',
  'CLARA_LOCAL_HOST',
  'CLARA_LOCAL_ACCESS',
  'CLARA_LOCAL_BIND_HOST',
  'CLARA_LOCAL_PORT',
  'CLARA_RELAY_URL',
  'CLARA_RELAY_ROOM',
  'CLARA_AGENT_TOKEN',
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
    expect(config.localAccess).toBe('loopback')
    expect(config.localBindHosts).toEqual(['127.0.0.1'])
    expect(config.relay).toBeUndefined()
    expect(config.sources.localHost).toBe('default')
    expect(config.sources.localAccess).toBe('default')
    expect(config.sources.localBindHost).toBe('default')
    expect(config.sources.localPort).toBe('default')
    expect(config.sources.relayUrl).toBe('none')
    expect(config.sources.pairingBaseUrl).toBe('default')
    expect(config.pairingBaseUrl).toBe('http://127.0.0.1:8080')
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
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify({
        local: { host: '0.0.0.0', port: 9000 },
        relay: { url: 'https://relay.example', room: 'file-room' },
        pairingBaseUrl: 'https://pair.example',
      }),
      { mode: 0o600 }
    )

    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_ROOM = 'env-room'
    process.env.CLARA_AGENT_TOKEN = 'agent-token'

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
    // This is what infra/docker/server.compose.yml passes when a value is optional.
    process.env.CLARA_RELAY_URL = ''
    process.env.CLARA_RELAY_ROOM = ''
    process.env.CLARA_AGENT_TOKEN = 'agent-token'

    const first = loadConfig()
    const second = loadConfig()

    expect(first.relay?.url).toBe('wss://relay.example')
    expect(first.relay?.room).toBe('file-room')
    expect(second.relay?.room).toBe('file-room')
    expect(first.sources).toMatchObject({
      relayUrl: 'file',
      relayRoom: 'file',
      agentToken: 'env',
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

    const first = loadConfig()
    const second = loadConfig()

    expect(first.relay?.room).toBeTruthy()
    expect(first.sources.relayRoom).toBe('generated')
    expect(second.relay?.room).toBe(first.relay?.room)
    expect(second.sources.relayRoom).toBe('file')
  })

  it('keeps the panel relay target when the environment overrides it', () => {
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

    const config = loadConfig()
    const saved = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'))

    expect(config.relay?.url).toBe('wss://new.example')
    expect(config.relay?.room).toBe('file-room')
    expect(saved.relay).toEqual({ url: 'wss://old.example', room: 'file-room' })
  })

  it('does not persist an environment-only relay URL', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'https://env.example'
    process.env.CLARA_AGENT_TOKEN = 'agent-token'

    const config = loadConfig()
    const saved = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'))

    expect(config.relay?.url).toBe('wss://env.example')
    expect(saved.relay?.url).toBeUndefined()
    expect(saved.relay?.room).toBe(config.relay?.room)
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

  it('uses a runtime port hint without writing it to server.json', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()

    const config = loadConfig({ localPortHint: 54321 })
    const saved = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'))

    expect(config.local.port).toBe(54321)
    expect(config.sources.localPort).toBe('runtime')
    expect(saved.local?.port).toBeUndefined()
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

describe('local access modes', () => {
  function configure(dir: string): void {
    process.env.CLARA_CONFIG_DIR = dir
    process.env.CLARA_DATA_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
  }

  it('binds all interfaces for lan access', () => {
    const dir = tempDir()
    configure(dir)
    process.env.CLARA_LOCAL_ACCESS = 'lan'

    const config = loadConfig()

    expect(config.localAccess).toBe('lan')
    expect(config.localBindHosts).toEqual(['0.0.0.0'])
    expect(config.local.bindHost).toBe('0.0.0.0')
    expect(config.sources.localAccess).toBe('env')
  })

  it('binds loopback plus a custom address', () => {
    const dir = tempDir()
    configure(dir)
    process.env.CLARA_LOCAL_ACCESS = 'custom'
    process.env.CLARA_LOCAL_BIND_HOST = '192.168.1.20'

    const config = loadConfig()

    expect(config.localAccess).toBe('custom')
    expect(config.localBindHosts).toEqual(['127.0.0.1', '192.168.1.20'])
    expect(config.local.bindHost).toBe('192.168.1.20')
    expect(config.localCustomHost).toBe('192.168.1.20')
    expect(config.sources.localBindHost).toBe('env')
  })

  it('rejects custom access without a bind address', () => {
    const dir = tempDir()
    configure(dir)
    process.env.CLARA_LOCAL_ACCESS = 'custom'

    expect(() => loadConfig()).toThrow(/requires CLARA_LOCAL_BIND_HOST/)
  })

  it('maps the legacy bind host to an access mode', () => {
    const dir = tempDir()
    configure(dir)
    process.env.CLARA_LOCAL_BIND_HOST = '0.0.0.0'

    const config = loadConfig()

    expect(config.localAccess).toBe('lan')
    expect(config.localBindHosts).toEqual(['0.0.0.0'])
    expect(config.sources.localAccess).toBe('env')
  })

  it('treats a non-loopback advertised host as a custom bind', () => {
    const dir = tempDir()
    configure(dir)
    process.env.CLARA_LOCAL_HOST = '192.168.1.20'

    const config = loadConfig()

    expect(config.localAccess).toBe('custom')
    expect(config.localBindHosts).toEqual(['127.0.0.1', '192.168.1.20'])
    expect(config.sources.localAccess).toBe('env')
  })

  it('persists a panel-selected access mode', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(path, JSON.stringify({ local: { host: '127.0.0.1', port: 8788 } }), {
      mode: 0o600,
    })

    saveLocalAccess(path, 'custom', '10.0.0.5')
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.local).toEqual({
      host: '127.0.0.1',
      port: 8788,
      access: 'custom',
      bindHost: '10.0.0.5',
    })
  })
})

describe('savePairingBaseUrl', () => {
  it('writes the value and preserves other fields', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(
      path,
      JSON.stringify({
        local: { host: '0.0.0.0', port: 9000 },
        psk: 'retired',
        relay: { url: 'wss://relay.example', room: 'room-1' },
        opencode: { url: 'http://old' },
      }),
      { mode: 0o600 }
    )

    savePairingBaseUrl(path, 'https://clara.example/')
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.pairingBaseUrl).toBe('https://clara.example')
    expect(saved.local).toEqual({ host: '0.0.0.0', port: 9000 })
    expect(saved.psk).toBeUndefined()
    expect(saved.relay).toEqual({ url: 'wss://relay.example', room: 'room-1' })
    expect(saved.opencode).toBeUndefined()
  })

  it('removes the value when cleared', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(
      path,
      JSON.stringify({ pairingBaseUrl: 'https://clara.example', psk: 'retired' }),
      { mode: 0o600 }
    )

    savePairingBaseUrl(path, undefined)
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.pairingBaseUrl).toBeUndefined()
  })
})

describe('panel-managed relay configuration', () => {
  it('allows a relay URL without a token until the feature merges its stored credential', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    process.env.CLARA_RELAY_URL = 'wss://relay.example'
    process.env.CLARA_RELAY_ROOM = 'room-1'

    const config = loadConfig()
    expect(config.relay?.agentToken).toBe('')
    expect(() => validateRelayConfig(config)).toThrow(/Missing CLARA_AGENT_TOKEN/)

    config.relay = {
      url: 'wss://relay.example',
      room: 'room-1',
      agentToken: AGENT_TOKEN,
    }
    expect(() => validateRelayConfig(config)).not.toThrow()
  })

  it('writes a panel relay target without a token', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(path, JSON.stringify({ local: { host: '127.0.0.1', port: 8788 } }), {
      mode: 0o600,
    })

    saveRelayTarget(path, { url: 'wss://relay.example', room: 'room-1' })
    const saved = JSON.parse(readFileSync(path, 'utf8'))

    expect(saved.relay).toEqual({ url: 'wss://relay.example', room: 'room-1' })
    expect(saved.relay.agentToken).toBeUndefined()
    expect(readRelayTarget(path)).toEqual({ url: 'wss://relay.example', room: 'room-1' })

    saveRelayTarget(path, undefined)
    expect(JSON.parse(readFileSync(path, 'utf8')).relay).toBeUndefined()
    expect(readRelayTarget(path)).toBeUndefined()
  })

  it('replaces only the generated room', () => {
    const dir = tempDir()
    const path = join(dir, 'server.json')
    writeFileSync(path, JSON.stringify({ relay: { url: 'wss://relay.example', room: 'room-1' } }), {
      mode: 0o600,
    })

    saveRelayRoom(path, 'room-2')
    expect(readRelayTarget(path)).toEqual({ url: 'wss://relay.example', room: 'room-2' })
  })

  it('fills only a missing hub token from the sealed store', () => {
    const dir = tempDir()
    process.env.CLARA_CONFIG_DIR = dir
    process.env.XDG_STATE_HOME = tempDir()
    const config = loadConfig()
    config.relay = {
      url: 'wss://relay.example',
      room: 'room-1',
      agentToken: '',
    }
    config.sources.agentToken = 'none'

    const sealedToken = 's'.repeat(43)
    applyRelayCredentials(config, { agentToken: sealedToken })

    expect(config.relay.agentToken).toBe(sealedToken)
    expect(config.sources.agentToken).toBe('file')
    expect(() => validateRelayConfig(config)).not.toThrow()
  })
})

function configWithToken(agentToken: string): ServerConfig {
  const dir = tempDir()
  process.env.CLARA_CONFIG_DIR = dir
  process.env.XDG_STATE_HOME = tempDir()
  const config = loadConfig()
  config.relay = { url: 'wss://relay.example', room: 'room-1', agentToken }
  return config
}

describe('relay token validation', () => {
  it('accepts generated, minimum, maximum, and base64 tokens', () => {
    expect(() => validateRelayConfig(configWithToken(AGENT_TOKEN))).not.toThrow()
    expect(() => validateRelayConfig(configWithToken('a'.repeat(32)))).not.toThrow()
    expect(() => validateRelayConfig(configWithToken('a'.repeat(512)))).not.toThrow()
    // `openssl rand -base64 32` can emit +, /, and =; only whitespace and
    // commas are rejected so existing working tokens keep working.
    expect(() => validateRelayConfig(configWithToken('Ab+/='.repeat(11)))).not.toThrow()
  })

  it('rejects a token shorter than 32 characters', () => {
    expect(() => validateRelayConfig(configWithToken('a'.repeat(31)))).toThrow(TOKEN_FORMAT_ERROR)
  })

  it('rejects a token longer than 512 characters', () => {
    expect(() => validateRelayConfig(configWithToken('a'.repeat(513)))).toThrow(TOKEN_FORMAT_ERROR)
  })

  it('rejects whitespace and commas', () => {
    expect(() =>
      validateRelayConfig(configWithToken(`${'a'.repeat(21)} ${'a'.repeat(21)}`))
    ).toThrow(TOKEN_FORMAT_ERROR)
    expect(() => validateRelayConfig(configWithToken(`${'a'.repeat(42)},`))).toThrow(
      TOKEN_FORMAT_ERROR
    )
  })
})
