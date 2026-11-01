import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { bytesToBase64Url, generatePsk, parsePsk, randomBytes } from '@clara/crypto'

export type RelayConfig = {
  url: string
  room: string
  agentToken: string
  clientToken: string
}

export type ConfigSource = 'env' | 'file' | 'service' | 'default' | 'generated' | 'none'

export type ServerConfigSources = {
  opencodeUrl: ConfigSource
  opencodePassword: ConfigSource
  localHost: ConfigSource
  localPort: ConfigSource
  relayUrl: ConfigSource
  relayRoom: ConfigSource
  agentToken: ConfigSource
  clientToken: ConfigSource
  psk: ConfigSource
  pairingBaseUrl: ConfigSource
}

export type ServerConfig = {
  opencode: {
    url: string
    password?: string
  }
  local: {
    host: string
    port: number
  }
  relay?: RelayConfig
  psk: string
  pairingBaseUrl: string
  configDir: string
  configPath: string
  dbPath: string
  sources: ServerConfigSources
}

type ConfigFile = {
  opencode?: {
    url?: string
    password?: string
  }
  local?: {
    host?: string
    port?: number
  }
  relay?: {
    url?: string
    room?: string
    agentToken?: string
    clientToken?: string
  }
  psk?: string
  pairingBaseUrl?: string
}

const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096'
const DEFAULT_LOCAL_HOST = '127.0.0.1'
const DEFAULT_LOCAL_PORT = 8788
const DEFAULT_PAIRING_BASE_URL = 'https://clara.kalenmichael.com'

export function loadConfig(options: { rotate?: boolean } = {}): ServerConfig {
  const configDir = process.env.CLARA_CONFIG_DIR ?? join(homedir(), '.config', 'clara')
  const configPath = join(configDir, 'server.json')
  const file = readConfig(configPath)
  const service = readOpenCodeService()

  const opencodeUrlSource: ConfigSource =
    process.env.CLARA_OPENCODE_URL !== undefined
      ? 'env'
      : file.opencode?.url !== undefined
        ? 'file'
        : service?.url !== undefined
          ? 'service'
          : 'default'
  const opencodeUrl =
    process.env.CLARA_OPENCODE_URL ?? file.opencode?.url ?? service?.url ?? DEFAULT_OPENCODE_URL
  const opencodePassword =
    process.env.CLARA_OPENCODE_PASSWORD ?? file.opencode?.password ?? service?.password
  const opencodePasswordSource: ConfigSource = opencodePassword
    ? process.env.CLARA_OPENCODE_PASSWORD !== undefined
      ? 'env'
      : file.opencode?.password !== undefined
        ? 'file'
        : 'service'
    : 'none'

  const localHostSource: ConfigSource =
    process.env.CLARA_LOCAL_HOST !== undefined
      ? 'env'
      : file.local?.host !== undefined
        ? 'file'
        : 'default'
  const localHost = process.env.CLARA_LOCAL_HOST ?? file.local?.host ?? DEFAULT_LOCAL_HOST
  const localPortSource: ConfigSource =
    process.env.CLARA_LOCAL_PORT !== undefined
      ? 'env'
      : file.local?.port !== undefined
        ? 'file'
        : 'default'
  const localPort = parsePort(
    process.env.CLARA_LOCAL_PORT ?? String(file.local?.port ?? DEFAULT_LOCAL_PORT)
  )

  const relayUrl = process.env.CLARA_RELAY_URL ?? file.relay?.url
  const relayUrlSource: ConfigSource =
    process.env.CLARA_RELAY_URL !== undefined
      ? 'env'
      : file.relay?.url !== undefined
        ? 'file'
        : 'none'
  const configuredRoom = process.env.CLARA_RELAY_ROOM ?? file.relay?.room
  const relayRoom = configuredRoom || createRoom()
  const relayRoomSource: ConfigSource = !relayUrl
    ? 'none'
    : !configuredRoom
      ? 'generated'
      : process.env.CLARA_RELAY_ROOM !== undefined
        ? 'env'
        : 'file'
  const agentToken = process.env.CLARA_AGENT_TOKEN ?? file.relay?.agentToken
  const agentTokenSource: ConfigSource =
    process.env.CLARA_AGENT_TOKEN !== undefined
      ? 'env'
      : file.relay?.agentToken !== undefined
        ? 'file'
        : 'none'
  const clientToken = process.env.CLARA_CLIENT_TOKEN ?? file.relay?.clientToken
  const clientTokenSource: ConfigSource =
    process.env.CLARA_CLIENT_TOKEN !== undefined
      ? 'env'
      : file.relay?.clientToken !== undefined
        ? 'file'
        : 'none'

  const relay = relayUrl
    ? {
        url: normalizeRelayUrl(relayUrl),
        room: relayRoom,
        agentToken: agentToken ?? '',
        clientToken: clientToken ?? '',
      }
    : undefined

  if (relay && (!relay.agentToken || !relay.clientToken)) {
    const missing = [
      relay.agentToken ? null : 'CLARA_AGENT_TOKEN',
      relay.clientToken ? null : 'CLARA_CLIENT_TOKEN',
    ]
      .filter(Boolean)
      .join(' and ')
    throw new Error(
      `Missing ${missing}. The relay URL is configured in ${configPath}, but tokens are never ` +
        `stored there. Add them to ${join(configDir, 'server.env')} (systemd EnvironmentFile), ` +
        `export them before starting the agent, or set them under "relay" in ${configPath}.`
    )
  }

  const psk = options.rotate ? generatePsk() : (process.env.CLARA_PSK ?? file.psk ?? generatePsk())
  const pskSource: ConfigSource = options.rotate
    ? 'generated'
    : process.env.CLARA_PSK !== undefined
      ? 'env'
      : file.psk !== undefined
        ? 'file'
        : 'generated'
  parsePsk(psk)

  const pairingBaseUrlSource: ConfigSource =
    process.env.CLARA_PAIRING_BASE_URL !== undefined
      ? 'env'
      : file.pairingBaseUrl !== undefined
        ? 'file'
        : 'default'
  const pairingBaseUrl = (
    process.env.CLARA_PAIRING_BASE_URL ??
    file.pairingBaseUrl ??
    DEFAULT_PAIRING_BASE_URL
  ).replace(/\/+$/, '')

  const config: ServerConfig = {
    opencode: {
      url: opencodeUrl.replace(/\/+$/, ''),
      password: opencodePassword || undefined,
    },
    local: { host: localHost, port: localPort },
    relay,
    psk,
    pairingBaseUrl,
    configDir,
    configPath,
    dbPath: resolveDatabasePath(configDir),
    sources: {
      opencodeUrl: opencodeUrlSource,
      opencodePassword: opencodePasswordSource,
      localHost: localHostSource,
      localPort: localPortSource,
      relayUrl: relay ? relayUrlSource : 'none',
      relayRoom: relay ? relayRoomSource : 'none',
      agentToken: relay ? agentTokenSource : 'none',
      clientToken: relay ? clientTokenSource : 'none',
      psk: pskSource,
      pairingBaseUrl: pairingBaseUrlSource,
    },
  }

  persistConfig(configPath, file, config, options.rotate === true)
  return config
}

function readConfig(path: string): ConfigFile {
  try {
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf8')) as ConfigFile
  } catch (cause) {
    throw new Error(`Could not read ${path}: ${errorMessage(cause)}`, { cause })
  }
}

type LocalService = {
  url?: string
  password?: string
}

function readOpenCodeService(): LocalService | undefined {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  const path = join(stateHome, 'opencode', 'service.json')
  try {
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LocalService
    if (typeof parsed.url !== 'string') return undefined
    return {
      url: parsed.url,
      password: typeof parsed.password === 'string' ? parsed.password : undefined,
    }
  } catch {
    return undefined
  }
}

function persistConfig(
  path: string,
  previous: ConfigFile,
  config: ServerConfig,
  rotated: boolean
): void {
  const relayChanged = Boolean(config.relay) && previous.relay?.room !== config.relay?.room
  const pskChanged = rotated || previous.psk !== config.psk
  const localChanged =
    previous.local?.host !== config.local.host || previous.local?.port !== config.local.port
  const pairingChanged = previous.pairingBaseUrl !== config.pairingBaseUrl
  if (!relayChanged && !pskChanged && !localChanged && !pairingChanged) return

  const next: ConfigFile = {
    ...previous,
    local: config.local,
    psk: config.psk,
    pairingBaseUrl: config.pairingBaseUrl,
  }
  if (config.relay) {
    next.relay = {
      ...previous.relay,
      url: config.relay.url,
      room: config.relay.room,
    }
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
}

function resolveDatabasePath(configDir: string): string {
  return process.env.CLARA_DB_PATH?.trim() || join(configDir, 'clara.db')
}

function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`
  if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
    throw new Error('The relay URL must start with ws://, wss://, http://, or https://')
  }
  return trimmed
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid local port: ${value}`)
  }
  return port
}

function createRoom(): string {
  return bytesToBase64Url(randomBytes(16))
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
