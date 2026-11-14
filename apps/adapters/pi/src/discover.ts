import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { AdapterProbe } from '@clara/adapter-runtime'
import { argValue, hasFlag } from '@clara/adapter-runtime'
import { resolveAgentDir, type PiConfig, type PiThinkingLevel, type PiTrust } from './config.ts'

const VERSION_TIMEOUT_MS = 4_000
const HELP_TIMEOUT_MS = 6_000

export type PiInstallation = {
  binary: string
  version?: string
}

export type PiInstallOptions = {
  pair?: string
  piPath?: string
  agentDir?: string
  sessionDir?: string
  model?: string
  thinkingLevel?: PiThinkingLevel
  trust?: PiTrust
  idleTimeoutMinutes?: number
  maxProcesses?: number
  noService?: boolean
  dryRun?: boolean
}

const THINKING_LEVELS: PiThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const cached = new Map<string, { version?: string; rpc: boolean; checkedAt: number }>()

/** Locate the user's Pi binary without assuming a package manager. */
export function findPiBinary(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const candidates: string[] = []
  if (explicit?.trim()) candidates.push(explicit.trim())
  if (env.PI_BIN?.trim()) candidates.push(env.PI_BIN.trim())

  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory) candidates.push(join(directory, 'pi'))
  }
  const home = homedir()
  candidates.push(
    join(home, '.pi', 'agent', 'bin', 'pi'),
    join(home, '.local', 'bin', 'pi'),
    join(home, 'bin', 'pi')
  )

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

export function readPiVersion(binary: string): string | undefined {
  const result = spawnSync(binary, ['--version'], {
    timeout: VERSION_TIMEOUT_MS,
    encoding: 'utf8',
  })
  if (result.status !== 0) return undefined
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const match = text.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)
  return match?.[0]
}

/** Pi RPC mode and session flags are the only surface this adapter uses. */
export function supportsRpc(binary: string): boolean {
  const result = spawnSync(binary, ['--help'], {
    timeout: HELP_TIMEOUT_MS,
    encoding: 'utf8',
  })
  if (result.status !== 0) return false
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return text.includes('--mode') && text.includes('rpc') && text.includes('--session')
}

export function detectPiInstallation(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env
): PiInstallation | undefined {
  const binary = findPiBinary(explicit, env)
  if (!binary || !existsSync(binary)) return undefined
  const version = readPiVersion(binary)
  return { binary, ...(version ? { version } : {}) }
}

/**
 * Probe the harness for `serve`. This stays cheap: health checks run every few
 * seconds. The full RPC handshake is a separate install-time check.
 */
export async function probePi(config: PiConfig, timeoutMs = 3_000): Promise<AdapterProbe> {
  const started = Date.now()
  const binary = findPiBinary(config.piPath)
  if (!binary) {
    return {
      ok: false,
      code: 'unconfigured',
      latencyMs: Date.now() - started,
      status: 503,
      message:
        'Pi was not found. Install it from https://pi.dev, or reinstall the adapter with --pi-path <path>.',
    }
  }
  const cachedResult = cached.get(binary)
  const now = Date.now()
  if (cachedResult && now - cachedResult.checkedAt < timeoutMs * 10) {
    return cachedProbe(cachedResult, binary, started)
  }
  const version = readPiVersion(binary)
  if (!version) {
    return {
      ok: false,
      code: 'offline',
      latencyMs: Date.now() - started,
      status: 503,
      message: `${binary} did not answer --version`,
    }
  }
  const rpc = supportsRpc(binary)
  const result = { version, rpc, checkedAt: now }
  cached.set(binary, result)
  return cachedProbe(result, binary, started)
}

function cachedProbe(
  result: { version?: string; rpc: boolean },
  binary: string,
  started: number
): AdapterProbe {
  if (!result.rpc) {
    return {
      ok: false,
      code: 'unsupported',
      latencyMs: Date.now() - started,
      status: 501,
      message: `${binary} does not support Pi RPC mode. Update Pi with \`pi update\`.`,
    }
  }
  return {
    ok: true,
    ...(result.version ? { version: result.version } : {}),
    latencyMs: Date.now() - started,
    status: 200,
    code: 'ready',
  }
}

/** Clear the cached version probe, used after an install or explicit refresh. */
export function resetPiProbe(): void {
  cached.clear()
}

export function parseInstallOptions(args: string[]): PiInstallOptions {
  const thinking = argValue(args, '--thinking')
  if (thinking && !THINKING_LEVELS.includes(thinking as PiThinkingLevel)) {
    throw new Error(`--thinking must be one of ${THINKING_LEVELS.join(', ')}`)
  }
  const trust = argValue(args, '--project-trust')
  if (trust && trust !== 'inherit' && trust !== 'always' && trust !== 'never') {
    throw new Error('--project-trust must be inherit, always, or never')
  }
  const idle = argValue(args, '--idle-timeout')
  const maxProcesses = argValue(args, '--max-processes')
  return {
    ...(argValue(args, '--pair') ? { pair: argValue(args, '--pair') } : {}),
    ...(argValue(args, '--pi-path') ? { piPath: argValue(args, '--pi-path') } : {}),
    ...(argValue(args, '--agent-dir') ? { agentDir: argValue(args, '--agent-dir') } : {}),
    ...(argValue(args, '--session-dir') ? { sessionDir: argValue(args, '--session-dir') } : {}),
    ...(argValue(args, '--model') ? { model: argValue(args, '--model') } : {}),
    ...(thinking ? { thinkingLevel: thinking as PiThinkingLevel } : {}),
    ...(trust ? { trust: trust as PiTrust } : {}),
    ...(idle ? { idleTimeoutMinutes: Number(idle) } : {}),
    ...(maxProcesses ? { maxProcesses: Number(maxProcesses) } : {}),
    noService: hasFlag(args, '--no-service'),
    dryRun: hasFlag(args, '--dry-run'),
  }
}

export async function resolvePiConfig(args: string[]): Promise<PiConfig> {
  return resolvePiConfigFromOptions(parseInstallOptions(args))
}

export function resolvePiConfigFromOptions(options: PiInstallOptions): PiConfig {
  const installation = detectPiInstallation(options.piPath)
  if (!installation) {
    throw new Error(
      'Pi was not found on this machine. Install it with `curl -fsSL https://pi.dev/install.sh | sh`, or pass --pi-path <path>.'
    )
  }
  if (!supportsRpc(installation.binary)) {
    throw new Error(
      `Pi at ${installation.binary} does not support RPC mode. Update it with \`pi update\` and retry.`
    )
  }
  return {
    piPath: installation.binary,
    ...(options.agentDir ? { agentDir: options.agentDir } : {}),
    ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    trust: options.trust ?? 'inherit',
    ...(options.idleTimeoutMinutes ? { idleTimeoutMinutes: options.idleTimeoutMinutes } : {}),
    ...(options.maxProcesses ? { maxProcesses: options.maxProcesses } : {}),
  }
}

/** Arguments shared by every Pi process this adapter starts. */
export function piProcessEnv(
  config: PiConfig,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...env,
    PI_CODING_AGENT_DIR: resolveAgentDir(config, env),
    ...(config.sessionDir?.trim() ? { PI_CODING_AGENT_SESSION_DIR: config.sessionDir.trim() } : {}),
  }
}
