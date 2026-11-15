import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { buildVersion } from '../../../build/version.mjs'
import { root, run } from './router.mjs'

/** Build metadata for a checkout build. */
export function buildInfoEnv(repoRoot = root) {
  const version = buildVersion({
    packageVersion: packageVersion(repoRoot),
    commit: gitValue(['rev-parse', '--short=7', 'HEAD'], repoRoot) || undefined,
  })
  const commit = gitValue(['rev-parse', '--short=8', 'HEAD'], repoRoot)
  return {
    ...(commit
      ? {
          CLARA_COMMIT: commit,
          CLARA_DIRTY: gitValue(['status', '--porcelain'], repoRoot) ? '1' : '0',
        }
      : {}),
    CLARA_VERSION: version,
  }
}

function packageVersion(repoRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function gitValue(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

export const SERVER_ENTRY = join(root, 'apps', 'hub', 'server', 'dist', 'index.js')

export function panelPort(env = process.env) {
  return positiveInt(env.CLARA_PANEL_PORT, 8790)
}

export function localPort(env = process.env) {
  return positiveInt(env.CLARA_LOCAL_PORT, 8788)
}

export function enginePort(env = process.env) {
  return positiveInt(env.CLARA_ENGINE_PORT ?? env.CLARA_ORCHESTRATION_PORT, 8789)
}

export function engineURL(env = process.env) {
  return `http://127.0.0.1:${enginePort(env)}`
}

export function panelURL(env = process.env) {
  const state = readRuntimeState()
  if (isRuntimeLive(state) && state.panel) return state.panel.url.replace(/\/+$/, '')
  return `http://127.0.0.1:${panelPort(env)}`
}

export function localURL(env = process.env) {
  const state = readRuntimeState()
  if (isRuntimeLive(state) && state.local) return state.local.url.replace(/\/+$/, '')
  return `http://127.0.0.1:${localPort(env)}`
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

export function runLocalServerProcess(args) {
  if (existsSync(SERVER_ENTRY)) {
    return run(process.execPath, [SERVER_ENTRY, ...args], { cwd: root })
  }
  const source = join(root, 'apps', 'hub', 'server', 'src', 'index.ts')
  if (existsSync(source)) {
    return run(process.execPath, ['--experimental-strip-types', '--no-warnings', source, ...args], {
      cwd: root,
    })
  }
  console.error('The hub service is not built. Run `pnpm build` first.')
  return 1
}

/** The host directories a local install uses, mirroring apps/hub/server/src/config.ts. */
export function serverLocalState(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  const runtime = readRuntimeState()
  const configDir =
    (isRuntimeLive(runtime) ? runtime.configDir : undefined) ||
    env.CLARA_CONFIG_DIR?.trim() ||
    join(configHome, 'clara')
  const dataDirPath =
    (isRuntimeLive(runtime) ? runtime.dataDir : undefined) ||
    env.CLARA_DATA_DIR?.trim() ||
    join(dataHome, 'clara')
  const dbPath = env.CLARA_DB_PATH?.trim() || join(dataDirPath, 'clara.db')
  return {
    configDir,
    dataDir: dataDirPath,
    dbPath,
    present:
      isRuntimeLive(runtime) ||
      existsSync(dbPath) ||
      existsSync(join(configDir, 'server.json')) ||
      existsSync(join(configDir, 'admin-setup.txt')),
  }
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
