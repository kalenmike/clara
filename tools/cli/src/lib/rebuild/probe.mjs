// Local service discovery for the rebuild lifecycle.
//
// Everything here is read-only. The probes respect the same environment the
// running services use, and fall back to common ports so an older Lab or a
// panel started from another checkout is still visible.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { findListenerPid, systemdUnitActive } from '../local-runtime.mjs'
import { engineContainerRunning, readEngineToken } from '../stack-control.mjs'
import { dataDir } from './state.mjs'

export {
  canSignal,
  findListenerPid,
  parseFuserPid,
  parseLsofPids,
  parseSsListeners,
  processCommand,
  processMatches,
  readProcessEnv,
  systemdUnitActive,
  waitForExit,
} from '../local-runtime.mjs'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback
}

export function numberOrNull(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function stringOrUndefined(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function ensureHttpURL(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/$/, '')
}

export function orchestratorURL(env = process.env) {
  const configured = ensureHttpURL(env.CLARA_ENGINE_URL || env.CLARA_ORCHESTRATION_URL)
  if (configured) return configured
  const host = env.CLARA_ENGINE_HOST?.trim() || env.CLARA_ORCHESTRATION_HOST?.trim() || '127.0.0.1'
  const port = positiveInt(env.CLARA_ENGINE_PORT ?? env.CLARA_ORCHESTRATION_PORT, 8789)
  return `http://${host}:${port}`
}

export function isLoopbackURL(value) {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname)
  } catch {
    return false
  }
}

export function readToken(env = process.env) {
  const configured = env.CLARA_ENGINE_TOKEN?.trim() || env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured

  const file = env.CLARA_ENGINE_TOKEN_FILE?.trim() || env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim()
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim()
    } catch {
      return ''
    }
  }

  // The Docker stack keeps its own control token so a local install and a
  // containerised stack never share credentials.
  if (engineContainerRunning()) {
    const dockerToken = readEngineToken(undefined, env)
    if (dockerToken) return dockerToken
  }

  for (const name of ['engine.token', 'orchestrator.token']) {
    try {
      return readFileSync(join(dataDir(env), name), 'utf8').trim()
    } catch {
      // Try the next name.
    }
  }
  return ''
}

export async function fetchJson(url, { timeoutMs = 1500, headers } = {}) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    return { ok: response.ok, status: response.status, body, text }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: undefined,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function probeOrchestrator({
  url = orchestratorURL(),
  token = readToken(),
  timeoutMs = 1500,
} = {}) {
  const base = ensureHttpURL(url)
  const health = await fetchJson(`${base}/health`, { timeoutMs })
  if (
    !health.ok ||
    !health.body ||
    (health.body.service !== 'clara-engine' && health.body.service !== 'clara-orchestrator')
  ) {
    return {
      expected: false,
      healthy: false,
      state: health.status === 0 ? 'unreachable' : 'foreign',
      url: base,
      ...(health.error ? { error: health.error } : {}),
    }
  }

  const mode = health.body.mode === 'container' ? 'container' : 'local'
  const managed = isLoopbackURL(base)
  const result = {
    expected: true,
    healthy: true,
    state: mode,
    url: base,
    mode,
    pid: numberOrNull(health.body.pid),
    version: stringOrUndefined(health.body.version),
    managed,
    external: !managed,
  }

  if (token) {
    const config = await fetchJson(`${base}/v1/config`, {
      timeoutMs,
      headers: { authorization: `Bearer ${token}` },
    })
    if (config.ok && config.body && typeof config.body === 'object') {
      result.workspace = stringOrUndefined(config.body.workspace)
      result.configPath = stringOrUndefined(config.body.configPath)
    } else if (config.status === 401) {
      result.warning = 'the engine rejected the token; workspace is unknown'
    }
  }
  return result
}

export function labPorts(env = process.env) {
  const ports = []
  const configured = env.CLARA_LAB_PORT?.trim()
  if (configured) {
    const port = positiveInt(configured, 0)
    if (port) ports.push(port)
  }
  for (let port = 8791; port <= 8799; port++) {
    if (!ports.includes(port)) ports.push(port)
  }
  return ports
}

export async function probeLabPort(port, timeoutMs = 1200) {
  const url = `http://127.0.0.1:${port}`
  const health = await fetchJson(`${url}/api/health`, { timeoutMs })
  if (!health.ok || !health.body || health.body.service !== 'clara-lab') {
    return {
      expected: false,
      healthy: false,
      state: health.status === 0 ? 'stopped' : 'foreign',
      url,
      port,
      ...(health.error ? { error: health.error } : {}),
    }
  }
  return {
    expected: true,
    healthy: true,
    state: 'running',
    url,
    port,
    pid: numberOrNull(health.body.pid) ?? findListenerPid(port) ?? null,
    root: stringOrUndefined(health.body.root),
    workspace: stringOrUndefined(health.body.workspace),
    orchestrator: stringOrUndefined(health.body.engine ?? health.body.orchestrator),
    orchestratorWorkspace: stringOrUndefined(health.body.orchestratorWorkspace),
    connected: health.body.connected === true,
    version: stringOrUndefined(health.body.version),
    tokenPresent: health.body.tokenPresent === true,
  }
}

export async function probeLab({ ports = labPorts(), timeoutMs = 1200 } = {}) {
  for (const port of ports) {
    const result = await probeLabPort(port, timeoutMs)
    if (result.expected) return result
  }
  return { expected: false, healthy: false, state: 'stopped', ports }
}

export function panelPort(env = process.env) {
  const state = readRuntimeState()
  if (isRuntimeLive(state) && state.panel) return state.panel.port
  return positiveInt(env.CLARA_PANEL_PORT, 8790)
}

export function localPort(env = process.env) {
  const state = readRuntimeState()
  if (isRuntimeLive(state) && state.local) return state.local.port
  return positiveInt(env.CLARA_LOCAL_PORT, 8788)
}

export function webPort(env = process.env) {
  return positiveInt(env.CLARA_WEB_PORT, 8080)
}

export async function probeWeb({ port = webPort(), timeoutMs = 1500, container = false } = {}) {
  const url = `http://127.0.0.1:${port}`
  const health = await fetchJson(`${url}/healthz`, { timeoutMs })
  const mode = container ? 'container' : 'local'
  if (!health.ok || !health.body || health.body.service !== 'clara-web') {
    return {
      expected: false,
      healthy: false,
      state: health.status === 0 ? 'stopped' : 'foreign',
      url,
      port,
      mode,
      ...(health.error ? { error: health.error } : {}),
    }
  }
  return {
    expected: true,
    healthy: true,
    state: 'running',
    url,
    port,
    mode,
  }
}

export async function probeServer({
  panelPort: panel = panelPort(),
  localPort: local = localPort(),
  timeoutMs = 1500,
} = {}) {
  const panelURL = `http://127.0.0.1:${panel}/health`
  const panelHealth = await fetchJson(panelURL, { timeoutMs })
  let panelInfo
  if (
    panelHealth.ok &&
    panelHealth.body &&
    panelHealth.body.ok === true &&
    panelHealth.body.service === 'clara-server'
  ) {
    const body = panelHealth.body
    panelInfo = {
      healthy: true,
      url: panelURL,
      version: stringOrUndefined(body.version),
      mode: body.mode === 'container' ? 'container' : 'local',
      container: body.mode === 'container',
    }
  }

  const effectiveLocalPort = local
  const localURL = `http://127.0.0.1:${effectiveLocalPort}/health`
  const localHealth = await fetchJson(localURL, { timeoutMs })
  let localInfo
  if (localHealth?.ok && localHealth.body && localHealth.body.ok === true) {
    localInfo = {
      healthy: true,
      url: localURL,
      version: stringOrUndefined(localHealth.body.version),
      protocol: numberOrNull(localHealth.body.protocol),
      sessions: numberOrNull(localHealth.body.sessions),
    }
  }

  const expected = Boolean(panelInfo || localInfo)
  // The hub publishes its own pid in the runtime file. Prefer it over host
  // tools such as ss/lsof/fuser, which minimal installs may not provide.
  const runtime = readRuntimeState()
  const runtimePid = isRuntimeLive(runtime) && runtime.mode === 'local' ? runtime.pid : undefined
  const pid =
    panelInfo?.container === true
      ? null
      : (runtimePid ?? findListenerPid(effectiveLocalPort) ?? findListenerPid(panel) ?? null)
  return {
    expected,
    healthy: expected,
    state: expected ? 'running' : panelHealth.status === 0 ? 'stopped' : 'foreign',
    panel: panelInfo ?? null,
    local: localInfo ?? null,
    pid,
    panelPort: panel,
    localPort: effectiveLocalPort,
    ...(panelInfo?.mode ? { mode: panelInfo.mode } : {}),
    systemd: panelInfo?.container === true ? false : systemdUnitActive('clara'),
  }
}

export async function waitForProbe(probe, predicate, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await probe()
    if (predicate(last)) return { ok: true, value: last }
    await delay(intervalMs)
  }
  return { ok: false, value: last }
}
