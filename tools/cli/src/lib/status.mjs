import { engineURL, localURL, panelURL, probe } from './server-control.mjs'
import { webURL } from './local-web.mjs'
import { docsPort, docsURL, labPort, labURL, labHealthy } from './dev-services.mjs'
import { readPid } from './local-runtime.mjs'

const SERVICES = ['engine', 'server', 'web']

function probeError(result) {
  if (result.error) {
    return /JSON|Unexpected token|not valid JSON/i.test(result.error)
      ? 'unexpected response'
      : result.error
  }
  if (typeof result.status === 'number') return `HTTP ${result.status}`
  return 'unreachable'
}

async function probeService(url, service) {
  const result = await probe(url)
  if (!result.ok) return { health: 'fail', error: probeError(result) }
  const body = result.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { health: 'fail', error: `${url} did not return a health object` }
  }
  const expected = Array.isArray(service) ? service : [service]
  if (!expected.includes(body.service)) {
    return {
      health: 'foreign',
      error: `${url} answered as ${typeof body.service === 'string' ? body.service : 'another service'}`,
    }
  }
  return { health: 'ok', body }
}

export function resolveState({ health, mode = 'unknown' }) {
  if (health === 'foreign') return { state: 'unavailable', mode: 'unknown' }
  if (health === 'ok') {
    return { state: 'running', mode: mode === 'unknown' ? 'external' : mode }
  }
  return { state: 'stopped', mode }
}

export function displayState(record) {
  return record.mode && record.mode !== 'unknown'
    ? `${record.state} (${record.mode})`
    : record.state
}

async function collectEngineStatus() {
  const service = await probeService(`${engineURL()}/health`, 'clara-engine')
  const mode = service.body?.mode ?? (service.health === 'ok' ? 'external' : 'unknown')
  const resolved = resolveState({ health: service.health, mode })
  return {
    service: 'engine',
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: engineURL(),
    error: service.error ?? null,
    details: {
      database: resolved.mode === 'local' ? 'local data directory' : 'unknown',
      pid: service.body?.pid ? String(service.body.pid) : 'none',
    },
  }
}

async function collectServerStatus() {
  const [panel, local] = await Promise.all([
    probeService(`${panelURL()}/health`, 'clara-server'),
    probe(`${localURL()}/health`),
  ])
  const mode = panel.body?.mode ?? (local.ok || panel.health === 'ok' ? 'local' : 'unknown')

  let resolved
  const setupRequired = panel.health === 'ok' && panel.body?.setupRequired === true
  if (panel.health === 'foreign') {
    resolved = { state: 'unavailable', mode: 'unknown' }
  } else if (panel.health === 'ok' && (local.ok || setupRequired)) {
    resolved = resolveState({ health: 'ok', mode })
  } else if (panel.health === 'ok' || local.ok) {
    resolved = { state: 'degraded', mode }
  } else {
    resolved = resolveState({ health: 'fail', mode })
  }

  const session =
    panel.health === 'ok' ? await probe(`${panelURL()}/panel/api/v1/session`) : undefined
  const panelState =
    panel.health === 'ok' ? 'running' : panel.health === 'foreign' ? 'foreign service' : 'stopped'
  const details = {
    panel: `${panelURL()} (${panelState})`,
  }
  if (session?.ok && session.body) {
    const body = session.body
    details.admin = body.setupRequired
      ? 'setup required'
      : body.resetPending
        ? 'reset pending'
        : 'configured'
    if (body.authenticated) details.session = `signed in as ${body.user.username}`
  } else {
    details.admin = 'unknown'
  }

  const error =
    panel.health === 'foreign'
      ? panel.error
      : panel.health === 'ok'
        ? null
        : (panel.error ?? (local.ok ? null : probeError(local)))

  return {
    service: 'hub',
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: localURL(),
    error: error ?? null,
    details,
  }
}

async function collectWebStatus() {
  const service = await probeService(`${webURL()}/healthz`, 'clara-web')
  const mode = service.body?.mode ?? (service.health === 'ok' ? 'external' : 'unknown')
  const resolved = resolveState({ health: service.health, mode })
  return {
    service: 'web',
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: webURL(),
    error: service.error ?? null,
    details: { kind: 'static SPA' },
  }
}

async function collectLabStatus() {
  const port = labPort()
  const healthy = await labHealthy(port)
  const pidState = readPid('lab')
  const state = healthy ? 'running' : pidState.alive ? 'unhealthy' : 'stopped'
  return {
    service: 'lab',
    state,
    mode: 'local',
    healthy,
    url: labURL(port),
    error: healthy || !pidState.alive ? null : 'the Lab process is running but is not answering',
    details: {
      pid: pidState.pid ? String(pidState.pid) : 'none',
      port: String(port),
    },
  }
}

async function collectDocsStatus() {
  const port = docsPort()
  const pidState = readPid('docs')
  let reachable = false
  try {
    const response = await fetch(docsURL(port), {
      cache: 'no-store',
      signal: AbortSignal.timeout(1_500),
    })
    reachable = response.ok
  } catch {
    reachable = false
  }
  const state = reachable ? 'running' : pidState.alive ? 'unhealthy' : 'stopped'
  return {
    service: 'docs',
    state,
    mode: 'local',
    healthy: reachable,
    url: docsURL(port),
    error: reachable || !pidState.alive ? null : 'the docs process is running but is not answering',
    details: {
      pid: pidState.pid ? String(pidState.pid) : 'none',
      port: String(port),
    },
  }
}

const collectors = {
  engine: collectEngineStatus,
  server: collectServerStatus,
  hub: collectServerStatus,
  web: collectWebStatus,
  lab: collectLabStatus,
  docs: collectDocsStatus,
}

export async function collectStatus(names = SERVICES) {
  const unknown = names.find((name) => !collectors[name])
  if (unknown) throw new Error(`unknown service: ${unknown}`)
  return Promise.all(names.map((name) => collectors[name]()))
}

function detailLine(details) {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ')
}

export function renderStatus(records, { title = 'Clara stack', write = console.log } = {}) {
  const headers = ['SERVICE', 'STATE', 'URL']
  const rows = records.map((record) => [record.service, displayState(record), record.url])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  )
  const line = (cells) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd()

  write(title)
  write('')
  write(line(headers))
  for (const row of rows) write(line(row))

  const detailed = records.filter((record) => Object.keys(record.details ?? {}).length > 0)
  if (detailed.length > 0) {
    write('')
    write('Details')
    if (records.length === 1) {
      const entries = Object.entries(records[0].details ?? {})
      const width = Math.max(...entries.map(([key]) => key.length))
      for (const [key, value] of entries) write(`  ${key.padEnd(width)}  ${value}`)
    } else {
      const width = Math.max(...detailed.map((record) => record.service.length))
      for (const record of detailed) {
        write(`  ${record.service.padEnd(width)}  ${detailLine(record.details)}`)
      }
    }
  }

  const failed = records.filter((record) => record.error)
  if (failed.length > 0) {
    write('')
    write('Errors')
    for (const record of failed) write(`  ${record.service}: ${record.error}`)
  }
}

export function renderJSON(records, { stack = false, write = console.log } = {}) {
  const payload = stack
    ? { ok: records.every((record) => record.healthy), services: records }
    : records[0]
  write(JSON.stringify(payload, null, 2))
}

export function statusExitCode(records) {
  return records.every((record) => record.healthy) ? 0 : 1
}
