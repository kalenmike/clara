import { spawnSync } from 'node:child_process'
import { CONTAINERS, SERVICES, orchestratorURL } from './stack-control.mjs'
import { localURL, panelURL, probe } from './server-control.mjs'
import { webURL } from './web-control.mjs'

const UNKNOWN_CONTAINER = { available: false, state: 'unknown' }

export function containerState(name) {
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Status}}', name], {
    encoding: 'utf8',
    timeout: 2_000,
  })
  if (result.error) return UNKNOWN_CONTAINER
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '')
    if (stderr.includes('No such object') || stderr.includes('No such container')) {
      return { available: true, state: 'missing' }
    }
    return UNKNOWN_CONTAINER
  }
  return { available: true, state: result.stdout.trim() || 'unknown' }
}

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
  if (body.service !== service) {
    return {
      health: 'foreign',
      error: `${url} answered as ${typeof body.service === 'string' ? body.service : 'another service'}`,
    }
  }
  return { health: 'ok', body }
}

export function resolveState({ health, container = UNKNOWN_CONTAINER, mode = 'unknown' }) {
  if (health === 'foreign') return { state: 'unavailable', mode: 'unknown' }
  if (health === 'ok') {
    if (mode !== 'unknown') return { state: 'running', mode }
    if (container.state === 'running') return { state: 'running', mode: 'container' }
    return { state: 'running', mode: 'external' }
  }
  if (container.state === 'running' || container.state === 'restarting') {
    return { state: 'unhealthy', mode: 'container' }
  }
  if (
    container.state === 'exited' ||
    container.state === 'created' ||
    container.state === 'dead' ||
    container.state === 'paused'
  ) {
    return { state: 'stopped', mode: 'container' }
  }
  if (!container.available) return { state: 'unknown', mode: 'unknown' }
  return { state: 'stopped', mode }
}

export function displayState(record) {
  return record.mode && record.mode !== 'unknown'
    ? `${record.state} (${record.mode})`
    : record.state
}

async function collectOrchestratorStatus() {
  const service = await probeService(`${orchestratorURL()}/health`, 'clara-orchestrator')
  const container = containerState(CONTAINERS.orchestrator)
  const mode =
    service.body?.mode ??
    (container.state === 'running' ? 'container' : service.health === 'ok' ? 'external' : 'unknown')
  const resolved = resolveState({ health: service.health, container, mode })
  return {
    service: 'orchestrator',
    container: CONTAINERS.orchestrator,
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: orchestratorURL(),
    error: service.error ?? null,
    details: {
      database:
        resolved.mode === 'container'
          ? process.env.CLARA_ORCHESTRATOR_DATA_DIR?.trim()
            ? 'host bind from CLARA_ORCHESTRATOR_DATA_DIR'
            : 'Docker volume clara-orchestrator-data'
          : resolved.mode === 'local'
            ? 'local data directory'
            : 'unknown',
      pid: service.body?.pid ? String(service.body.pid) : 'none',
    },
  }
}

async function collectServerStatus() {
  const [panel, local] = await Promise.all([
    probeService(`${panelURL()}/health`, 'clara-server'),
    probe(`${localURL()}/health`),
  ])
  const container = containerState(CONTAINERS.server)
  const panelMode = panel.body?.mode
  const mode =
    panelMode ??
    (container.state === 'running'
      ? 'container'
      : local.ok || panel.health === 'ok'
        ? 'local'
        : 'unknown')

  let resolved
  if (panel.health === 'foreign') {
    resolved = { state: 'unavailable', mode: 'unknown' }
  } else if (panel.health === 'ok' && local.ok) {
    resolved = resolveState({ health: 'ok', container, mode })
  } else if (panel.health === 'ok' || local.ok) {
    resolved = { state: 'degraded', mode }
  } else {
    resolved = resolveState({ health: 'fail', container, mode })
  }

  const session =
    panel.health === 'ok' ? await probe(`${panelURL()}/panel/api/v1/session`) : undefined
  const details = {
    panel:
      panel.health === 'ok'
        ? `running at ${panelURL()}`
        : panel.health === 'foreign'
          ? `foreign service at ${panelURL()}`
          : `stopped at ${panelURL()}`,
    local: local.ok ? `running at ${localURL()}` : `stopped at ${localURL()}`,
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
    service: 'server',
    container: CONTAINERS.server,
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: panelURL(),
    error: error ?? null,
    details,
  }
}

async function collectWebStatus() {
  const service = await probeService(`${webURL()}/healthz`, 'clara-web')
  const container = containerState(CONTAINERS.web)
  const mode =
    container.state === 'running' ? 'container' : service.health === 'ok' ? 'external' : 'unknown'
  const resolved = resolveState({ health: service.health, container, mode })
  return {
    service: 'web',
    container: CONTAINERS.web,
    state: resolved.state,
    mode: resolved.mode,
    healthy: resolved.state === 'running',
    url: webURL(),
    error: service.error ?? null,
    details: { kind: 'static SPA' },
  }
}

const collectors = {
  orchestrator: collectOrchestratorStatus,
  server: collectServerStatus,
  web: collectWebStatus,
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

export function renderStatus(
  records,
  { title = 'Clara stack', write = console.log, urlHeader = 'URL' } = {}
) {
  const headers = ['SERVICE', 'CONTAINER', 'STATE', urlHeader]
  const rows = records.map((record) => [
    record.service,
    record.container,
    displayState(record),
    record.url,
  ])
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
