import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './router.mjs'

export function composeFile(repoRoot = root) {
  return join(repoRoot, 'docker', 'server.compose.yml')
}

export function envFile(repoRoot = root) {
  return join(repoRoot, 'docker', '.env')
}

export function compose(args, repoRoot = root) {
  return run('docker', composeArgs(args, repoRoot), { cwd: repoRoot })
}

/** Load docker/.env so `clara server ... --docker` matches the documented setup. */
function composeArgs(args, repoRoot = root) {
  const file = envFile(repoRoot)
  const envArgs = existsSync(file) ? ['--env-file', file] : []
  return ['compose', ...envArgs, '-f', composeFile(repoRoot), ...args]
}

export const SERVER_ENTRY = join(root, 'apps', 'server', 'dist', 'index.js')
export const NETWORK = 'clara'
export const SERVER_CONTAINER = 'clara-server'
export const SERVER_VOLUMES = ['clara-server-config', 'clara-server-data']

export function panelPort(env = process.env) {
  return positiveInt(env.CLARA_PANEL_PORT, 8790)
}

export function localPort(env = process.env) {
  return positiveInt(env.CLARA_LOCAL_PORT, 8788)
}

export function panelURL(env = process.env) {
  return `http://127.0.0.1:${panelPort(env)}`
}

export function localURL(env = process.env) {
  return `http://127.0.0.1:${localPort(env)}`
}

export function ensureNetwork() {
  const inspect = spawnSync('docker', ['network', 'inspect', NETWORK], { stdio: 'ignore' })
  if (inspect.status === 0) return 0
  return run('docker', ['network', 'create', NETWORK])
}

export async function probe(url, timeoutMs = 1_500) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, status: response.status, body: await response.json() }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export async function waitForPanel(timeoutMs = 60_000, env = process.env) {
  const deadline = Date.now() + timeoutMs
  const url = `${panelURL(env)}/health`
  while (Date.now() < deadline) {
    const result = await probe(url)
    if (result.ok && result.body?.service === 'clara-server') return result.body
    await sleep(300)
  }
  return undefined
}

export function serverRunningInCompose(repoRoot = root) {
  const result = spawnSync('docker', composeArgs(['ps', '-q', 'server'], repoRoot), {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return result.status === 0 && result.stdout.trim().length > 0
}

export function runServerProcess(args) {
  if (serverRunningInCompose()) {
    return compose(['exec', '-T', 'server', 'node', '/app/dist/index.js', ...args])
  }
  return compose(['run', '--rm', 'server', ...args])
}

export function runLocalServerProcess(args) {
  return run(process.execPath, [SERVER_ENTRY, ...args], { cwd: root })
}

/** The hub container by name, without throwing when Docker is missing. */
export function serverContainerState() {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Status}}', SERVER_CONTAINER],
    {
      encoding: 'utf8',
      timeout: 2_000,
    }
  )
  if (result.error) return { available: false, state: 'unknown' }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '')
    if (stderr.includes('No such object') || stderr.includes('No such container')) {
      return { available: true, state: 'missing' }
    }
    return { available: false, state: 'unknown' }
  }
  return { available: true, state: result.stdout.trim() || 'unknown' }
}

/** Whether either server state volume exists. */
export function serverVolumesExist() {
  return SERVER_VOLUMES.some((name) => {
    const result = spawnSync('docker', ['volume', 'inspect', name], {
      stdio: 'ignore',
      timeout: 2_000,
    })
    return result.status === 0
  })
}

/** A snapshot of the Docker side, or zeros when the Docker CLI is unavailable. */
export function dockerServerState() {
  const container = serverContainerState()
  const exists = container.available && container.state !== 'missing'
  const volumes = container.available ? serverVolumesExist() : false
  return {
    available: container.available,
    container: container.state,
    running: container.state === 'running' || container.state === 'restarting',
    exists,
    volumes,
    present: exists || volumes,
  }
}

/** The host directories a local install uses, mirroring apps/server/src/config.ts. */
export function serverLocalState(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  const configDir = env.CLARA_CONFIG_DIR?.trim() || join(configHome, 'clara')
  const dataDir = env.CLARA_DATA_DIR?.trim() || join(dataHome, 'clara')
  const dbPath = env.CLARA_DB_PATH?.trim() || join(dataDir, 'clara.db')
  return {
    configDir,
    dataDir,
    dbPath,
    present:
      existsSync(dbPath) ||
      existsSync(join(configDir, 'server.json')) ||
      existsSync(join(configDir, 'admin-setup.txt')),
  }
}

/**
 * Pick the deployment a host command should operate on. Pure so the decision
 * can be tested without Docker or a running panel.
 */
export function resolveServerTarget(input = {}) {
  if (input.docker === true && input.local === true) {
    return { target: 'ambiguous', reason: 'both --docker and --local were passed' }
  }
  if (input.docker === true) return { target: 'container', reason: '--docker' }
  if (input.local === true) return { target: 'local', reason: '--local' }
  if (input.health === 'container') {
    return { target: 'container', reason: 'the panel is running in a container' }
  }
  if (input.health === 'local') {
    return { target: 'local', reason: 'the panel is running locally' }
  }
  if (input.dockerState?.running === true) {
    return { target: 'container', reason: 'the clara-server container is running' }
  }
  const dockerPresent = input.dockerState?.present === true
  const localPresent = input.localState?.present === true
  if (dockerPresent && !localPresent) {
    return { target: 'container', reason: 'Docker state exists without a local install' }
  }
  if (localPresent && !dockerPresent) {
    return { target: 'local', reason: 'a local install exists without Docker state' }
  }
  if (dockerPresent && localPresent) {
    return { target: 'ambiguous', reason: 'both a local install and Docker state exist' }
  }
  return { target: 'local', reason: 'no Docker state was found' }
}

/** Resolve the target, probing the panel and Docker only when it is not forced. */
export async function detectServerTarget(options = {}) {
  const env = options.env ?? process.env
  if (options.docker === true || options.local === true) {
    return resolveServerTarget({ docker: options.docker, local: options.local })
  }
  const health = await serverHealthMode(env)
  if (health) return resolveServerTarget({ health })
  return resolveServerTarget({
    dockerState: options.dockerState ?? dockerServerState(),
    localState: options.localState ?? serverLocalState(env),
  })
}

async function serverHealthMode(env) {
  const result = await probe(`${panelURL(env)}/health`)
  if (!result.ok) return undefined
  const mode = result.body?.mode
  return mode === 'container' || mode === 'local' ? mode : undefined
}

export async function status(env = process.env) {
  const panel = await probe(`${panelURL(env)}/health`)
  const local = await probe(`${localURL(env)}/health`)
  let session
  if (panel.ok) session = await probe(`${panelURL(env)}/panel/api/v1/session`)
  return { panel, local, session }
}

export function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
