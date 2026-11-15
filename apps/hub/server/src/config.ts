import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LocalAccessMode } from '@clara/shared-types'
import { bytesToBase64Url, randomBytes } from '@clara/crypto'
import { isWildcardHost, localBindHosts as computeLocalBindHosts } from './runtime/addresses.ts'

export type RelayConfig = {
  url: string
  room: string
  agentToken: string
}

export type ConfigSource = 'env' | 'file' | 'default' | 'generated' | 'runtime' | 'none'

export type ServerConfigSources = {
  localHost: ConfigSource
  localAccess?: ConfigSource
  localBindHost: ConfigSource
  localPort: ConfigSource
  relayUrl: ConfigSource
  relayRoom: ConfigSource
  agentToken: ConfigSource
  pairingBaseUrl: ConfigSource
  adapterRegistryUrl: ConfigSource
}

export type ServerConfig = {
  local: {
    /** Advertised or paired host. */
    host: string
    /** Primary listener address; may be 0.0.0.0 in a container. */
    bindHost: string
    port: number
  }
  /** Which interfaces the local WebSocket listener binds. */
  localAccess?: LocalAccessMode
  /** Every listener address for the selected access mode. */
  localBindHosts?: string[]
  /** The stored custom bind address, even when another mode is active. */
  localCustomHost?: string
  relay?: RelayConfig
  pairingBaseUrl: string
  /** Base URL for adapter registry manifests and install scripts. */
  adapterRegistryUrl: string
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
    access?: LocalAccessMode
    bindHost?: string
    port?: number
  }
  relay?: {
    url?: string
    room?: string
    agentToken?: string
  }
  pairingBaseUrl?: string
  adapterRegistryUrl?: string
}

const DEFAULT_LOCAL_HOST = '127.0.0.1'
const DEFAULT_LOCAL_PORT = 8788
const DEFAULT_WEB_PORT = 8080
export const DEFAULT_ADAPTER_REGISTRY_URL = 'https://clara.kalenmichael.com/adapters'

const RELAY_TOKEN_MIN_LENGTH = 32
const RELAY_TOKEN_MAX_LENGTH = 512
const RELAY_TOKEN_FORMAT_ERROR =
  'The relay token must be at least 32 characters with no spaces or commas. Use the generated value or `openssl rand -base64 32`.'

export function loadConfig(
  options: {
    noRelay?: boolean
    /** Last local port from the runtime file; reused when no explicit value exists. */
    localPortHint?: number
  } = {}
): ServerConfig {
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
  const envBind = readEnv('CLARA_LOCAL_BIND_HOST')
  const fileBind = nonEmpty(file.local?.bindHost)
  const envAccess = parseLocalAccess(readEnv('CLARA_LOCAL_ACCESS'), 'CLARA_LOCAL_ACCESS')
  const fileAccess = parseLocalAccess(file.local?.access, configPath)

  // `CLARA_LOCAL_HOST` was the only way to expose the listener before access
  // modes existed. Treat a non-loopback advertised host as a custom bind so
  // existing deployments keep working.
  let bindValue = envBind ?? fileBind
  let bindSource: ConfigSource = envBind ? 'env' : fileBind ? 'file' : 'none'
  if (
    !envAccess &&
    !fileAccess &&
    !bindValue &&
    localHost !== DEFAULT_LOCAL_HOST &&
    localHost !== 'localhost'
  ) {
    bindValue = localHost
    bindSource = localHostSource
  }

  const localAccess: LocalAccessMode =
    envAccess ??
    fileAccess ??
    (bindValue ? (isWildcardHost(bindValue) ? 'lan' : 'custom') : 'loopback')
  const localAccessSource: ConfigSource = envAccess
    ? 'env'
    : fileAccess
      ? 'file'
      : bindValue
        ? bindSource
        : 'default'
  if (localAccess === 'custom' && !bindValue) {
    throw new Error(
      'Local access mode "custom" requires CLARA_LOCAL_BIND_HOST or local.bindHost in server.json'
    )
  }
  const localBindHost =
    localAccess === 'lan' ? '0.0.0.0' : localAccess === 'custom' ? bindValue! : '127.0.0.1'
  const localBindHosts = computeLocalBindHosts(localAccess, bindValue)
  const localCustomHost = bindValue || undefined
  const localPortHint =
    Number.isInteger(options.localPortHint) &&
    options.localPortHint !== undefined &&
    options.localPortHint >= 0 &&
    options.localPortHint <= 65_535
      ? options.localPortHint
      : undefined
  const localPortSource: ConfigSource =
    process.env.CLARA_LOCAL_PORT !== undefined
      ? 'env'
      : file.local?.port !== undefined
        ? 'file'
        : localPortHint !== undefined
          ? 'runtime'
          : 'default'
  const localPort = parsePort(
    process.env.CLARA_LOCAL_PORT ?? String(file.local?.port ?? localPortHint ?? DEFAULT_LOCAL_PORT)
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
  const relayRoom = configuredRoom || createRelayRoom()
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

  // A --no-relay pairing command skips the relay entirely: it neither needs the
  // tokens nor emits a relay room, and the local listener runs independently of
  // the relay client on a serving agent.
  const relay =
    !options.noRelay && relayUrl
      ? {
          url: normalizeRelayUrl(relayUrl),
          room: relayRoom,
          agentToken: agentToken ?? '',
        }
      : undefined

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

  const envAdapterRegistryUrl = readEnv('CLARA_ADAPTER_REGISTRY_URL')
  const fileAdapterRegistryUrl = nonEmpty(file.adapterRegistryUrl)
  const adapterRegistryUrlSource: ConfigSource = envAdapterRegistryUrl
    ? 'env'
    : fileAdapterRegistryUrl
      ? 'file'
      : 'default'
  const adapterRegistryUrl = envAdapterRegistryUrl
    ? configuredAdapterRegistryUrl(envAdapterRegistryUrl, 'env', configPath)
    : fileAdapterRegistryUrl
      ? configuredAdapterRegistryUrl(fileAdapterRegistryUrl, 'file', configPath)
      : DEFAULT_ADAPTER_REGISTRY_URL

  const config: ServerConfig = {
    local: { host: localHost, bindHost: localBindHost, port: localPort },
    localAccess,
    localBindHosts,
    ...(localCustomHost ? { localCustomHost } : {}),
    relay,
    pairingBaseUrl,
    adapterRegistryUrl,
    configDir,
    configPath,
    dataDir,
    dbPath: resolveDatabasePath(dataDir),
    sources: {
      localHost: localHostSource,
      localAccess: localAccessSource,
      localBindHost: bindValue ? bindSource : localHostSource,
      localPort: localPortSource,
      relayUrl: relay ? relayUrlSource : 'none',
      relayRoom: relay ? relayRoomSource : 'none',
      agentToken: relay ? agentTokenSource : 'none',
      pairingBaseUrl: pairingBaseUrlSource,
      adapterRegistryUrl: adapterRegistryUrlSource,
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
  // Environment values always win but are never written to the file. Keeping
  // the previous file value lets the panel remain the fallback when the
  // environment variable is removed again.
  const storedRelayUrl =
    config.sources.relayUrl === 'file' ? nonEmpty(config.relay?.url) : nonEmpty(previous.relay?.url)
  const storedRelayRoom =
    config.sources.relayRoom === 'file' || config.sources.relayRoom === 'generated'
      ? nonEmpty(config.relay?.room)
      : nonEmpty(previous.relay?.room)
  const relayChanged =
    previous.relay?.url !== storedRelayUrl || previous.relay?.room !== storedRelayRoom
  // The effective local endpoint can come from the runtime file or the default.
  // Keep server.json user-owned: never write an auto-selected port back to it.
  const storedPairingBaseUrl =
    config.sources.pairingBaseUrl === 'file'
      ? config.pairingBaseUrl
      : nonEmpty(previous.pairingBaseUrl)
  const pairingChanged =
    config.sources.pairingBaseUrl === 'file' && previous.pairingBaseUrl !== config.pairingBaseUrl
  const storedAdapterRegistryUrl =
    config.sources.adapterRegistryUrl === 'file'
      ? config.adapterRegistryUrl
      : nonEmpty(previous.adapterRegistryUrl)
  const adapterRegistryChanged =
    config.sources.adapterRegistryUrl === 'file' &&
    previous.adapterRegistryUrl !== config.adapterRegistryUrl
  // Drop retired fields from older files when the config is rewritten.
  const retiredCleared = previous.opencode !== undefined || previous.psk !== undefined
  if (
    !relayChanged &&
    !pairingChanged &&
    !adapterRegistryChanged &&
    !retiredCleared &&
    existsSync(path)
  )
    return

  // Rebuild the file without new credentials. Legacy plaintext tokens are kept
  // so an upgrade cannot lose them before the sealed relay store takes over;
  // the first panel save removes them.
  const next: ConfigFile = {
    ...(previous.local ? { local: previous.local } : {}),
  }
  if (storedPairingBaseUrl !== undefined) next.pairingBaseUrl = storedPairingBaseUrl
  if (storedAdapterRegistryUrl !== undefined) {
    next.adapterRegistryUrl = storedAdapterRegistryUrl
  }
  if (storedRelayUrl !== undefined || storedRelayRoom !== undefined) {
    next.relay = {
      ...(storedRelayUrl !== undefined ? { url: storedRelayUrl } : {}),
      ...(storedRelayRoom !== undefined ? { room: storedRelayRoom } : {}),
      ...(previous.relay?.agentToken !== undefined
        ? { agentToken: previous.relay.agentToken }
        : {}),
    }
  }

  writeConfigFile(path, next)
}

/**
 * Persist a panel-edited local access mode. The custom bind is kept so the
 * panel can switch back to it without retyping the address.
 */
export function saveLocalAccess(
  configPath: string,
  access: LocalAccessMode,
  bindHost?: string
): void {
  const previous = readConfig(configPath)
  const next: ConfigFile = { ...previous }
  delete next.opencode
  delete next.psk
  const local = { ...previous.local, access }
  if (bindHost?.trim()) local.bindHost = bindHost.trim()
  next.local = local
  writeConfigFile(configPath, next)
}

export function isLocalAccessMode(value: unknown): value is LocalAccessMode {
  return value === 'loopback' || value === 'docker' || value === 'lan' || value === 'custom'
}

export function parseLocalAccess(
  value: string | undefined,
  label: string
): LocalAccessMode | undefined {
  const text = value?.trim().toLowerCase()
  if (!text) return undefined
  if (isLocalAccessMode(text)) return text
  throw new Error(
    `Invalid local access mode in ${label}: ${value}. Use loopback, docker, lan, or custom.`
  )
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

/**
 * Persist a panel-edited adapter registry URL. Clearing the value removes the
 * key so the next load falls back to the built-in default.
 */
export function saveAdapterRegistryUrl(configPath: string, value: string | undefined): void {
  const previous = readConfig(configPath)
  const nextValue = value?.trim() ? normalizeAdapterRegistryUrl(value) : undefined
  if (previous.adapterRegistryUrl === nextValue && previous.opencode === undefined) return

  const next: ConfigFile = { ...previous }
  delete next.opencode
  delete next.psk
  if (nextValue !== undefined) next.adapterRegistryUrl = nextValue
  else delete next.adapterRegistryUrl
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

export function normalizeAdapterRegistryUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('The adapter registry URL is required')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('The adapter registry URL must be a valid HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The adapter registry URL must start with http:// or https://')
  }
  if (url.username || url.password) {
    throw new Error('The adapter registry URL must not contain credentials')
  }
  if (url.search || url.hash) {
    throw new Error('The adapter registry URL must not contain a query or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

function configuredAdapterRegistryUrl(
  value: string,
  source: 'env' | 'file',
  configPath: string
): string {
  try {
    return normalizeAdapterRegistryUrl(value)
  } catch (cause) {
    const label = source === 'env' ? 'CLARA_ADAPTER_REGISTRY_URL' : configPath
    throw new Error(`Invalid adapter registry URL in ${label}: ${errorMessage(cause)}`, {
      cause,
    })
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

export function normalizeRelayUrl(value: string): string {
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
  // Zero means "let the listener choose an ephemeral port".
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid local port: ${value}`)
  }
  return port
}

function createRelayRoom(): string {
  return bytesToBase64Url(randomBytes(16))
}

export { createRelayRoom }

/**
 * Fail early when a relay URL has no usable credentials. The hub panel can
 * supply the tokens from its own encrypted store, so serving and pairing call
 * this after that merge rather than inside loadConfig.
 */
export function validateRelayConfig(config: ServerConfig): void {
  if (config.relay) assertRelayTokens(config.relay, config.configPath, config.configDir)
}

function assertRelayTokens(relay: RelayConfig, configPath: string, configDir: string): void {
  if (!relay.agentToken) {
    throw new Error(
      `Missing CLARA_AGENT_TOKEN. The relay URL is configured in ${configPath}. Save the hub ` +
        `token in the hub panel's Relay card, export it before starting the hub service, or add ` +
        `it to ${join(configDir, 'server.env')} (systemd EnvironmentFile).`
    )
  }
  // A comma would split the Sec-WebSocket-Protocol header and a short value is
  // guessable; both fail closed here instead of at the relay.
  if (!isValidRelayToken(relay.agentToken)) throw new Error(RELAY_TOKEN_FORMAT_ERROR)
}

function isValidRelayToken(value: string): boolean {
  return (
    value.length >= RELAY_TOKEN_MIN_LENGTH &&
    value.length <= RELAY_TOKEN_MAX_LENGTH &&
    !/[\s,]/.test(value)
  )
}

export type RelayTarget = {
  url?: string
  room?: string
}

/** Read the panel-managed relay target without environment overrides. */
export function readRelayTarget(configPath: string): RelayTarget | undefined {
  const relay = readConfig(configPath).relay
  if (!relay) return undefined
  const url = nonEmpty(relay.url)
  const room = nonEmpty(relay.room)
  if (!url && !room) return undefined
  return { ...(url ? { url } : {}), ...(room ? { room } : {}) }
}

/**
 * Persist a panel-managed relay target. The tokens live in the encrypted relay
 * credential file, never in server.json. Passing undefined removes the target.
 */
export function saveRelayTarget(configPath: string, relay: RelayTarget | undefined): void {
  const previous = readConfig(configPath)
  const next: ConfigFile = { ...previous }
  delete next.opencode
  delete next.psk
  if (relay && (relay.url || relay.room)) {
    next.relay = {
      ...(relay.url ? { url: relay.url } : {}),
      ...(relay.room ? { room: relay.room } : {}),
    }
  } else {
    delete next.relay
  }
  writeConfigFile(configPath, next)
}

/** Replace only the generated room, preserving the panel-managed URL. */
export function saveRelayRoom(configPath: string, room: string): void {
  const previousTarget = readRelayTarget(configPath)
  saveRelayTarget(configPath, { ...(previousTarget?.url ? { url: previousTarget.url } : {}), room })
}

/**
 * Merge credentials read from the sealed relay store into the effective config.
 * Environment and legacy file values keep their precedence; sealed tokens only
 * fill a missing token.
 */
export function applyRelayCredentials(
  config: ServerConfig,
  credentials: { agentToken?: string } | undefined
): void {
  if (!config.relay || !credentials) return
  if (!config.relay.agentToken && credentials.agentToken) {
    config.relay.agentToken = credentials.agentToken
    config.sources.agentToken = 'file'
  }
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
