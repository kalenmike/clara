import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export function tokenPath(): string {
  return (
    process.env.CLARA_ENGINE_TOKEN_FILE?.trim() ||
    process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() ||
    join(dataDir(), 'engine.token')
  )
}

/** Docker keeps its control token outside the local install data directory. */
function dockerTokenPath(): string {
  const configured = process.env.CLARA_DOCKER_STATE_DIR?.trim()
  if (configured) return join(resolve(configured), 'engine.token')
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara', 'docker', 'engine.token')
}

function legacyDockerTokenPath(): string {
  const configured = process.env.CLARA_DOCKER_STATE_DIR?.trim()
  if (configured) return join(resolve(configured), 'orchestrator.token')
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara', 'docker', 'orchestrator.token')
}

function dockerEngineRunning(): boolean {
  for (const name of ['clara-engine', 'clara-orchestrator']) {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    if (!result.error && result.status === 0 && result.stdout.trim() === 'true') return true
  }
  return false
}

function tokenFile(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trim()
}

export function readToken(): string {
  const configured =
    process.env.CLARA_ENGINE_TOKEN?.trim() || process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const explicit =
    process.env.CLARA_ENGINE_TOKEN_FILE?.trim() ||
    process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim()
  if (explicit) return tokenFile(explicit)
  if (dockerEngineRunning()) {
    const dockerToken = tokenFile(dockerTokenPath()) || tokenFile(legacyDockerTokenPath())
    if (dockerToken) return dockerToken
  }
  return tokenFile(tokenPath()) || tokenFile(join(dataDir(), 'orchestrator.token'))
}

export function engineURL(): string {
  return (
    process.env.CLARA_ENGINE_URL?.trim() ||
    process.env.CLARA_ORCHESTRATION_URL?.trim() ||
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
}

export function workspace(): string {
  return resolve(
    process.env.CLARA_ENGINE_WORKSPACE?.trim() ||
      process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ||
      process.cwd()
  )
}

export function labPort(): number {
  const parsed = Number(process.env.CLARA_LAB_PORT ?? 8791)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return 8791
  return parsed
}

export function labURL(port = labPort()): string {
  return `http://127.0.0.1:${port}/`
}

export function autostart(): boolean {
  const value = String(
    process.env.CLARA_ENGINE_AUTOSTART ?? process.env.CLARA_ORCHESTRATION_AUTOSTART ?? '1'
  ).toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

export function openBrowser(url: string): void {
  if (process.env.CLARA_LAB_OPEN === '0') return
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    const opener = spawn(command, args, { stdio: 'ignore', detached: true })
    opener.on('error', () => console.warn(`Could not open a browser. Visit ${url}`))
    opener.unref()
  } catch {
    console.warn(`Could not open a browser. Visit ${url}`)
  }
}

export async function healthy(url = engineURL()): Promise<boolean> {
  return fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
    .then((response) => response.ok)
    .catch(() => false)
}

function findRepoRoot(start: string): string | undefined {
  let current = resolve(start)
  for (;;) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) &&
      existsSync(join(current, 'apps', 'engine'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function repoRoot(): string {
  const configured = process.env.CLARA_ROOT?.trim()
  if (configured) return resolve(configured)
  return (
    findRepoRoot(process.cwd()) ??
    findRepoRoot(dirname(fileURLToPath(import.meta.url))) ??
    process.cwd()
  )
}

function engineCommand(): { command: string; args: string[] } | undefined {
  const configured =
    process.env.CLARA_ENGINE_BIN?.trim() || process.env.CLARA_ORCHESTRATOR_BIN?.trim()
  if (configured) return { command: process.execPath, args: [configured, 'start'] }
  const root = repoRoot()
  const dist = join(root, 'apps', 'engine', 'dist', 'index.js')
  if (existsSync(dist)) return { command: process.execPath, args: [dist, 'start'] }
  const source = join(root, 'apps', 'engine', 'src', 'index.ts')
  if (existsSync(source)) {
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', source, 'start'],
    }
  }
  return undefined
}

export async function ensureEngine(url = engineURL()): Promise<void> {
  if (await healthy(url)) return
  if (!autostart()) {
    throw new Error(`Clara engine is not running at ${url}`)
  }
  const command = engineCommand()
  if (!command) {
    throw new Error('Clara engine is not running and no executable was found')
  }
  console.error(`[clara-lab] starting engine at ${url}`)
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    if (await healthy(url)) return
  }
  throw new Error(`Clara engine did not become healthy at ${url}`)
}
