import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, run } from './router.mjs'

export const COMPOSE_FILE = join(root, 'docker', 'server.compose.yml')
export const ENV_FILE = join(root, 'docker', '.env')
export const SERVER_ENTRY = join(root, 'apps', 'server', 'dist', 'index.js')
export const NETWORK = 'clara'

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

export function compose(args) {
  return run('docker', composeArgs(args), { cwd: root })
}

/** Load docker/.env so `clara server ... --docker` matches the documented setup. */
function composeArgs(args) {
  const envFile = existsSync(ENV_FILE) ? ['--env-file', ENV_FILE] : []
  return ['compose', ...envFile, '-f', COMPOSE_FILE, ...args]
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

export function serverRunningInCompose() {
  const result = spawnSync('docker', composeArgs(['ps', '-q', 'server']), {
    cwd: root,
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
