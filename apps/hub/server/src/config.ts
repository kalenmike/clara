import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { bytesToBase64Url, randomBytes } from '@clara/crypto'

export type RelayConfig = {
  url: string
  room: string
  agentToken: string
  clientToken: string
}

export type ConfigSource = 'env' | 'file' | 'default' | 'generated' | 'none'

export type ServerConfigSources = {
  localHost: ConfigSource
  localBindHost: ConfigSource
  localPort: ConfigSource
  relayUrl: ConfigSource
  relayRoom: ConfigSource
  agentToken: ConfigSource
  clientToken: ConfigSource
  pairingBaseUrl: ConfigSource
}

export type ServerConfig = {
  local: {
    /** Advertised or paired host. */
    host: string
    /** Actual listener address; may be 0.0.0.0 in a container. */
    bindHost: string
    port: number
  }
  relay?: RelayConfig
  pairingBaseUrl: string
  configDir: string
  configPath: string
  dataDir: string
  dbPath: string
  sources: ServerConfigSources
}

type ConfigFile = {
  /** Retired fields are removed on the next config write. */
  opencode?: unknown
  psk?: unknown
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
  pairingBaseUrl?: string
}

const DEFAULT_LOCAL_HOST = '127.0.0.1'
const DEFAULT_LOCAL_PORT = 8788
const DEFAULT_WEB_PORT = 8080

export function loadConfig(options: { noRelay?: boolean } = {}): ServerConfig {
  const configDir = resolveConfigDir()
  const dataDir = resolveDataDir()
  const configPath = join(configDir, 'server.json')
  const file = readConfig(configPath)

  const localHostSource: ConfigSource =
    process.env.CLARA_LOCAL_HOST !== undefined
      ? 'env'
      : file.local?.host !== undefined
        ? 'file'
        : 'default'
  const localHost = process.env.CLARA_LOCAL_HOST ?? file.local?.host ?? DEFAULT_LOCAL_HOST
  const configuredBind = process.env.CLARA_LOCAL_BIND_HOST?.trim()
  const localBindHost = configuredBind || localHost
  const localBindHostSource: ConfigSource = configuredBind ? 'env' : localHostSource
  const localPortSource: ConfigSource =
    process.env.CLARA_LOCAL_PORT !== undefined
      ? 'env'
      : file.local?.port !== undefined
        ? 'file'
        : 'default'
  const localPort = parsePort(
    process.env.CLARA_LOCAL_PORT ?? String(file.local?.port ?? DEFAULT_LOCAL_PORT)
  )

  // Compose passes optional values through as empty strings (`${VAR:-}`). An
  // empty value means "not set": it must not mask server.json or force a new
  // relay room on every process start.
  const envRelayUrl = readEnv('CLARA_RELAY_URL')
  const fileRelayUrl = nonEmpty(file.relay?.url)
  const relayUrl = envRelayUrl ?? fileRelayUrl
  const relayUrlSource: ConfigSource = envRelayUrl ? 'env' : fileRelayUrl ? 'file' : 'none'
  const envRoom = readEnv('CLARA_RELAY_ROOM')
  const fileRoom = nonEmpty(file.relay?.room)
  const configuredRoom = envRoom ?? fileRoom
  const relayRoom = configuredRoom || createRoom()
  const relayRoomSource: ConfigSource = !relayUrl
    ? 'none'
    : !configuredRoom
      ? 'generated'
      : envRoom
        ? 'env'
        : 'file'
  const envAgentToken = readEnv('CLARA_AGENT_TOKEN')
  const fileAgentToken = nonEmpty(file.relay?.agentToken)
  const agentToken = envAgentToken ?? fileAgentToken
  const agentTokenSource: ConfigSource = envAgentToken ? 'env' : fileAgentToken ? 'file' : 'none'
  const envClientToken = readEnv('CLARA_CLIENT_TOKEN')
  const fileClientToken = nonEmpty(file.relay?.clientToken)
  const clientToken = envClientToken ?? fileClientToken
  const clientTokenSource: ConfigSource = envClientToken ? 'env' : fileClientToken ? 'file' : 'none'

  // A --no-relay pairing command skips the relay entirely: it neither needs the
  // tokens nor emits a relay room, and the local listener runs independently of
  // the relay client on a serving agent.
  const relay =
    !options.noRelay && relayUrl
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
        `export them before starting the hub service, or set them under "relay" in ${configPath}.`
    )
  }

  const envPairingBaseUrl = readEnv('CLARA_PAIRING_BASE_URL')
  const filePairingBaseUrl = nonEmpty(file.pairingBaseUrl)
  const pairingBaseUrlSource: ConfigSource = envPairingBaseUrl
    ? 'env'
    : filePairingBaseUrl
      ? 'file'
      : 'default'
  const pairingBaseUrl = envPairingBaseUrl
    ? configuredPairingBaseUrl(envPairingBaseUrl, 'env', configPath)
    : filePairingBaseUrl
      ? configuredPairingBaseUrl(filePairingBaseUrl, 'file', configPath)
      : defaultPairingBaseUrl()

  const config: ServerConfig = {
    local: { host: localHost, bindHost: localBindHost, port: localPort },
    relay,
    pairingBaseUrl,
    configDir,
    configPath,
    dataDir,
    dbPath: resolveDatabasePath(dataDir),
    sources: {
      localHost: localHostSource,
      localBindHost: localBindHostSource,
      localPort: localPortSource,
      relayUrl: relay ? relayUrlSource : 'none',
      relayRoom: relay ? relayRoomSource : 'none',
      agentToken: relay ? agentTokenSource : 'none',
      clientToken: relay ? clientTokenSource : 'none',
      pairingBaseUrl: pairingBaseUrlSource,
    },
  }

  persistConfig(configPath, file, config)
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

function persistConfig(path: string, previous: ConfigFile, config: ServerConfig): void {
  const relayChanged =
    Boolean(config.relay) &&
    (previous.relay?.url !== config.relay?.url || previous.relay?.room !== config.relay?.room)
  const localChanged =
    previous.local?.host !== config.local.host || previous.local?.port !== config.local.port
  const storedPairingBaseUrl =
    config.sources.pairingBaseUrl === 'file'
      ? config.pairingBaseUrl
      : nonEmpty(previous.pairingBaseUrl)
  const pairingChanged =
    config.sources.pairingBaseUrl === 'file' && previous.pairingBaseUrl !== config.pairingBaseUrl
  // Drop retired fields from older files when the config is rewritten.
  const retiredCleared = previous.opencode !== undefined || previous.psk !== undefined
  if (!relayChanged && !localChanged && !pairingChanged && !retiredCleared) return

  // Rebuild the file without legacy credentials. Harness connections live in
  // the database; device keys live in the encrypted device store.
  const next: ConfigFile = {
    local: { host: config.local.host, port: config.local.port },
  }
  if (storedPairingBaseUrl !== undefined) next.pairingBaseUrl = storedPairingBaseUrl
  if (config.relay) {
    next.relay = { url: config.relay.url, room: config.relay.room }
  }

  writeConfigFile(path, next)
}

/**
 * Persist a panel-edited Web URL. Clearing the value removes the key so the
 * next load falls back to the local default again.
 */
export function savePairingBaseUrl(configPath: string, value: string | undefined): void {
  const previous = readConfig(configPath)
  const nextValue = value?.trim() ? normalizePairingBaseUrl(value) : undefined
  if (previous.pairingBaseUrl === nextValue && previous.opencode === undefined) return

  const next: ConfigFile = { ...previous }
  delete next.opencode
  delete next.psk
  if (nextValue !== undefined) next.pairingBaseUrl = nextValue
  else delete next.pairingBaseUrl
  writeConfigFile(configPath, next)
}

export function localWebPort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.CLARA_WEB_PORT?.trim() ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : DEFAULT_WEB_PORT
}

export function defaultPairingBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${localWebPort(env)}`
}

export function normalizePairingBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('The web URL is required')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('The web URL must be a valid HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The web URL must start with http:// or https://')
  }
  if (url.username || url.password) {
    throw new Error('The web URL must not contain credentials')
  }
  if (url.search || url.hash) {
    throw new Error('The web URL must not contain a query or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

function configuredPairingBaseUrl(
  value: string,
  source: 'env' | 'file',
  configPath: string
): string {
  try {
    return normalizePairingBaseUrl(value)
  } catch (cause) {
    const label = source === 'env' ? 'CLARA_PAIRING_BASE_URL' : configPath
    throw new Error(`Invalid pairing Web URL in ${label}: ${errorMessage(cause)}`, { cause })
  }
}

function writeConfigFile(path: string, file: ConfigFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
}

export function loadAdminPaths(): { configDir: string; dataDir: string; dbPath: string } {
  const configDir = resolveConfigDir()
  const dataDir = resolveDataDir()
  return { configDir, dataDir, dbPath: resolveDatabasePath(dataDir) }
}

function resolveConfigDir(): string {
  const configured = process.env.CLARA_CONFIG_DIR?.trim()
  if (configured) return configured
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configHome, 'clara')
}

function resolveDataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(dataHome, 'clara')
}

function resolveDatabasePath(dataDir: string): string {
  return process.env.CLARA_DB_PATH?.trim() || join(dataDir, 'clara.db')
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

/** Environment values set to whitespace only are treated as absent. */
function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
