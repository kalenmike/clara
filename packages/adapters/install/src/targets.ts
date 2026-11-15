import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  PanelInstallDockerContainer,
  PanelInstallDockerTargets,
  PanelInstallSshHost,
  PanelInstallSshTargets,
} from '@clara/shared-types'
import type { RunCommand } from './types.ts'

const execFileAsync = promisify(execFile)
const SSH_TIMEOUT_MS = 5_000
const DOCKER_TIMEOUT_MS = 5_000
const MAX_INCLUDE_DEPTH = 3

const defaultRun: RunCommand = async (command, args, options) => {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  })
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

export type SshTargetsOptions = {
  homeDir?: string
  run?: RunCommand
}

export async function listSshTargets(
  options: SshTargetsOptions = {}
): Promise<PanelInstallSshTargets> {
  const home = options.homeDir ?? homedir()
  const hosts = readSshHosts(home)
  const run = options.run ?? defaultRun
  try {
    await run('ssh', ['-V'], { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 })
  } catch (cause) {
    return {
      available: false,
      reason: commandReason(cause, 'ssh', 'SSH is not installed on this machine.'),
      hosts,
    }
  }
  return { available: true, hosts }
}

export type DockerTargetsOptions = {
  run?: RunCommand
}

export async function listDockerTargets(
  options: DockerTargetsOptions = {}
): Promise<PanelInstallDockerTargets> {
  const run = options.run ?? defaultRun
  try {
    const result = await run('docker', ['ps', '--format', '{{json .}}'], {
      timeout: DOCKER_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    })
    const containers = parseDockerPs(result.stdout)
    const gateways = await dockerGateways(run, containers)
    return {
      available: true,
      containers: containers.map((container) => {
        const values = gateways.get(container.id)
        return values ? { ...container, gateways: values } : container
      }),
    }
  } catch (cause) {
    return {
      available: false,
      reason: commandReason(cause, 'docker', 'Docker is not available on this machine.'),
      containers: [],
    }
  }
}

/**
 * Ask Docker for each container's default gateway. The gateway is the host
 * address a local container can use to reach a hub that listens beyond
 * loopback. A failure here is non-fatal: the panel still lists the containers.
 */
async function dockerGateways(
  run: RunCommand,
  containers: PanelInstallDockerContainer[]
): Promise<Map<string, string[]>> {
  if (containers.length === 0) return new Map()
  try {
    const result = await run(
      'docker',
      [
        'inspect',
        '--format',
        '{{.Id}} {{json .NetworkSettings.Networks}}',
        ...containers.map((container) => container.id),
      ],
      { timeout: DOCKER_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }
    )
    return parseDockerGateways(result.stdout)
  } catch {
    return new Map()
  }
}

/** Parse `docker inspect` lines into `id → gateways`. Exported for tests. */
export function parseDockerGateways(output: string): Map<string, string[]> {
  const gateways = new Map<string, string[]>()
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    const space = text.indexOf(' ')
    if (space <= 0) continue
    const id = text.slice(0, space)
    let value: unknown
    try {
      value = JSON.parse(text.slice(space + 1))
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    const addresses: string[] = []
    for (const network of Object.values(value)) {
      if (!isRecord(network)) continue
      const gateway = network.Gateway
      if (typeof gateway === 'string' && gateway.trim()) addresses.push(gateway.trim())
    }
    const unique = [...new Set(addresses)]
    if (unique.length > 0) gateways.set(id.slice(0, 12), unique)
  }
  return gateways
}

export function parseDockerPs(output: string): PanelInstallDockerContainer[] {
  const containers: PanelInstallDockerContainer[] = []
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    const id = textField(value.ID)
    const name = textField(value.Names)
    if (!id || !name) continue
    const labels = parseLabels(textField(value.Labels))
    containers.push({
      id: id.slice(0, 12),
      name,
      image: textField(value.Image) ?? '',
      state: textField(value.State) ?? '',
      ...(labels['com.docker.compose.project']
        ? { project: labels['com.docker.compose.project'] }
        : {}),
      ...(labels['com.docker.compose.service']
        ? { service: labels['com.docker.compose.service'] }
        : {}),
    })
  }
  return containers.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Read the aliases a user configured in ~/.ssh/config. Only exact Host entries
 * are listed; wildcard and negated patterns cannot be selected as a destination.
 */
export function readSshHosts(homeDir = homedir()): PanelInstallSshHost[] {
  const sshDir = join(homeDir, '.ssh')
  const configPath = join(sshDir, 'config')
  if (!existsSync(configPath)) return []

  const hosts = new Map<string, PanelInstallSshHost>()
  const visited = new Set<string>()
  parseConfigFile(configPath, sshDir, homeDir, hosts, visited, 0)
  return [...hosts.values()].sort((left, right) => left.alias.localeCompare(right.alias))
}

function parseConfigFile(
  path: string,
  sshDir: string,
  homeDir: string,
  hosts: Map<string, PanelInstallSshHost>,
  visited: Set<string>,
  depth: number
): void {
  if (depth > MAX_INCLUDE_DEPTH) return
  const absolute = resolve(path)
  if (visited.has(absolute)) return
  visited.add(absolute)

  let text: string
  try {
    text = readFileSync(absolute, 'utf8')
  } catch {
    return
  }

  let current: HostBlock | undefined
  const flush = () => {
    if (!current) return
    for (const alias of current.aliases) {
      if (!alias || /[?*!]/.test(alias) || hosts.has(alias)) continue
      hosts.set(alias, {
        alias,
        hostname: current.hostname ?? alias,
        ...(current.user ? { user: current.user } : {}),
        ...(current.port !== undefined ? { port: current.port } : {}),
      })
    }
    current = undefined
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const tokens = splitTokens(line)
    if (tokens.length === 0) continue
    const key = tokens[0].toLowerCase()

    if (key === 'include') {
      for (const token of tokens.slice(1)) {
        for (const included of expandInclude(token, sshDir, homeDir)) {
          parseConfigFile(included, sshDir, homeDir, hosts, visited, depth + 1)
        }
      }
      continue
    }
    if (key === 'host') {
      flush()
      current = { aliases: tokens.slice(1) }
      continue
    }
    if (key === 'match') {
      // Match blocks can override connection fields, which the client cannot
      // preview. Keep the preceding exact Host entry and ignore the block.
      flush()
      continue
    }
    if (!current) continue

    if (key === 'hostname' && current.hostname === undefined) {
      current.hostname = tokens[1]
    } else if (key === 'user' && current.user === undefined) {
      current.user = tokens[1]
    } else if (key === 'port' && current.port === undefined) {
      const value = tokens[1] ?? ''
      if (/^\d+$/.test(value)) {
        const port = Number.parseInt(value, 10)
        if (port > 0 && port <= 65_535) current.port = port
      }
    }
  }
  flush()
}

type HostBlock = {
  aliases: string[]
  hostname?: string
  user?: string
  port?: number
}

function expandInclude(token: string, sshDir: string, homeDir: string): string[] {
  const expanded = token.startsWith('~') ? join(homeDir, token.slice(1)) : token
  const pattern = isAbsolute(expanded) ? expanded : join(sshDir, expanded)
  if (!/[?*]/.test(pattern)) return existsSync(pattern) ? [pattern] : []

  const directory = dirname(pattern)
  const matcher = globMatcher(basename(pattern))
  try {
    return readdirSync(directory)
      .filter((name) => matcher.test(name))
      .sort()
      .map((name) => join(directory, name))
  } catch {
    return []
  }
}

function globMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

function stripComment(line: string): string {
  const index = line.indexOf('#')
  return index >= 0 ? line.slice(0, index) : line
}

/** Split a config line on whitespace while honoring simple quoted values. */
function splitTokens(line: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  for (const character of line) {
    if (quote) {
      if (character === quote) quote = undefined
      else token += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }
  if (token) tokens.push(token)
  return tokens
}

function parseLabels(value: string | undefined): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const entry of (value ?? '').split(',')) {
    const index = entry.indexOf('=')
    if (index <= 0) continue
    labels[entry.slice(0, index)] = entry.slice(index + 1)
  }
  return labels
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function commandReason(cause: unknown, command: string, fallback: string): string {
  const error = cause as NodeJS.ErrnoException & { stderr?: unknown; killed?: boolean }
  if (error.code === 'ENOENT') return fallback
  if (error.killed) return `${command} did not answer within the timeout.`
  if (typeof error.stderr === 'string' && error.stderr.trim()) {
    const text = error.stderr.trim()
    return text.length > 200 ? `${text.slice(0, 197)}...` : text
  }
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
