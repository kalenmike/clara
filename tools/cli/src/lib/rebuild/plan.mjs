// Pure planning and health evaluation for the rebuild lifecycle.
//
// Keeping these functions independent of the filesystem and process table
// makes the restart order and the health verdict easy to test.

export const SERVICE_ORDER = ['web', 'lab', 'server', 'orchestrator']

export function parseWorktreeList(output) {
  const worktrees = []
  let current
  for (const line of String(output ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current)
      current = { path: line.slice('worktree '.length).trim(), branch: undefined }
    } else if (current && line.startsWith('branch ')) {
      current.branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '')
    }
  }
  if (current) worktrees.push(current)
  return worktrees
}

export function primaryWorktree(worktrees) {
  return worktrees.length > 0 ? worktrees[0].path : undefined
}

/**
 * The deployment form captured at status time. `compose` says whether the
 * hub container is running even when its panel is unreachable.
 */
export function deploymentModes({ orchestrator, lab, server, web, compose = {} } = {}) {
  const orchestratorMode =
    orchestrator?.mode === 'container' ? 'container' : orchestrator?.expected ? 'local' : 'stopped'
  const serverMode =
    server?.mode === 'container' || server?.panel?.container === true || compose.server === true
      ? 'container'
      : server?.expected
        ? 'local'
        : 'stopped'
  const labMode = lab?.expected ? 'host' : 'stopped'
  const webMode =
    web?.mode === 'container' || compose.web === true
      ? 'container'
      : web?.expected
        ? 'local'
        : 'stopped'
  return {
    orchestrator: {
      mode: orchestratorMode,
      container: orchestratorMode === 'container',
      external: Boolean(orchestrator?.external),
    },
    server: { mode: serverMode, container: serverMode === 'container' },
    lab: { mode: labMode },
    web: { mode: webMode, container: webMode === 'container' },
  }
}

function deploymentMode(name, captured, state) {
  const deployment = state?.deployment?.[name]
  if (deployment?.mode) return deployment.mode
  if (captured?.external) return captured?.mode ?? 'local'
  if (captured?.mode === 'container' || captured?.panel?.container === true) return 'container'
  if (!captured?.expected) return 'stopped'
  return name === 'lab' ? 'host' : 'local'
}

function serviceMode(name, state, captured) {
  if (name === 'lab') return 'local'
  const mode = state?.deployment?.[name]?.mode ?? captured?.mode
  if (mode === 'container') return 'docker'
  if (mode === 'local' || mode === 'host') return 'local'
  if (name === 'server' && captured?.panel?.container === true) return 'docker'
  if (captured?.expected) return 'local'
  return 'stopped'
}

/** Map the pre-`server` service name so old commands and snapshots keep working. */
function serviceName(name) {
  return name === 'control' ? 'server' : name
}

export function restartPlan(state, { skip = [], manageExternal = false, only, mode = 'all' } = {}) {
  const skipped = new Set(skip.map(serviceName))
  const wanted = only ? new Set(only.map(serviceName)) : undefined
  const services = []
  const warnings = []

  for (const name of SERVICE_ORDER) {
    const captured = state?.[name]
    const capturedMode = deploymentMode(name, captured, state)
    if (mode !== 'all' && serviceMode(name, state, captured) !== mode) {
      services.push({ name, action: 'skip', reason: `not a ${mode} service`, mode: capturedMode })
      continue
    }
    if (skipped.has(name)) {
      services.push({ name, action: 'skip', reason: 'skipped by flag', mode: capturedMode })
      continue
    }
    if (!captured?.expected) {
      services.push({
        name,
        action: 'skip',
        reason: 'not running when captured',
        mode: capturedMode,
      })
      continue
    }
    if (name === 'web' && capturedMode !== 'container' && mode !== 'local') {
      services.push({
        name,
        action: 'skip',
        reason: 'served outside this checkout',
        mode: capturedMode,
      })
      warnings.push(
        `web at ${captured.url ?? 'the configured port'} is not a container; restart it where it is served`
      )
      continue
    }
    if (wanted && !wanted.has(name)) {
      services.push({ name, action: 'skip', reason: 'already healthy', mode: capturedMode })
      continue
    }
    if (name === 'orchestrator' && captured.external && !manageExternal) {
      services.push({
        name,
        action: 'skip',
        reason: 'managed outside this checkout',
        mode: capturedMode,
      })
      warnings.push(
        `orchestrator at ${captured.url} is external; pass --manage-external to restart it`
      )
      continue
    }
    services.push({ name, action: 'restart', reason: 'running when captured', mode: capturedMode })
  }

  return { services, warnings }
}

/**
 * Restrict a captured restart plan to the services that are expected but not
 * answering. A curated recovery never restarts a healthy service, and it never
 * starts one that was stopped when the snapshot was taken.
 */
export function recoveryPlan(state, health, options = {}) {
  const planned = restartPlan(state, options)
  const unhealthy = new Set(
    (health?.services ?? [])
      .filter((service) => service.expected && !service.healthy)
      .map((service) => service.name)
  )
  const services = planned.services.map((service) =>
    service.action === 'restart' && !unhealthy.has(service.name)
      ? { ...service, action: 'skip', reason: 'healthy' }
      : service
  )
  return {
    services,
    warnings: planned.warnings,
    only: services.filter((service) => service.action === 'restart').map((service) => service.name),
  }
}

function serviceResult(name, expected, observed) {
  const healthy = observed?.healthy === true
  const warnings = []
  if (expected && !healthy) warnings.push(`${name} is not answering its health endpoint`)
  if (!expected && healthy) warnings.push(`${name} started although it was stopped when captured`)
  return {
    name,
    expected: Boolean(expected),
    healthy,
    state: observed?.state ?? 'unknown',
    url: observed?.url,
    detail: observed ?? null,
    warnings,
  }
}

function samePath(left, right) {
  if (!left || !right) return true
  return String(left).replace(/\/$/, '') === String(right).replace(/\/$/, '')
}

export function evaluateHealth(state, observed, { adapter, now = new Date(), mode = 'all' } = {}) {
  const services = []
  const warnings = []

  const orchestrator = serviceResult(
    'orchestrator',
    state?.orchestrator?.expected,
    observed?.orchestrator
  )
  const capturedOrchestratorMode =
    state?.deployment?.orchestrator?.mode ?? state?.orchestrator?.mode
  const observedOrchestratorMode = observed?.orchestrator?.mode
  if (
    state?.orchestrator?.expected &&
    observed?.orchestrator?.healthy &&
    capturedOrchestratorMode &&
    observedOrchestratorMode &&
    observedOrchestratorMode !== capturedOrchestratorMode
  ) {
    orchestrator.warnings.push(
      `mode changed from ${capturedOrchestratorMode} to ${observedOrchestratorMode}`
    )
  }
  if (
    state?.orchestrator?.workspace &&
    observed?.orchestrator?.workspace &&
    !samePath(state.orchestrator.workspace, observed.orchestrator.workspace)
  ) {
    orchestrator.warnings.push(
      `workspace changed from ${state.orchestrator.workspace} to ${observed.orchestrator.workspace}`
    )
  }
  if (state?.orchestrator?.external) {
    orchestrator.warnings.push('orchestrator is managed outside this checkout')
  }
  services.push(orchestrator)

  const lab = serviceResult('lab', state?.lab?.expected, observed?.lab)
  if (state?.lab?.connected && observed?.lab?.healthy && !observed.lab.connected) {
    lab.warnings.push(`lab lost its orchestrator connection at ${state.lab.orchestrator}`)
  }
  if (
    state?.lab?.workspace &&
    observed?.lab?.workspace &&
    !samePath(state.lab.workspace, observed.lab.workspace)
  ) {
    lab.warnings.push(`workspace changed from ${state.lab.workspace} to ${observed.lab.workspace}`)
  }
  services.push(lab)

  const server = serviceResult('server', state?.server?.expected, observed?.server)
  const capturedServerMode = state?.deployment?.server?.mode ?? state?.server?.mode
  const observedServerMode = observed?.server?.mode ?? observed?.server?.panel?.mode
  if (
    state?.server?.expected &&
    observed?.server?.healthy &&
    capturedServerMode &&
    observedServerMode &&
    capturedServerMode !== observedServerMode
  ) {
    server.warnings.push(`mode changed from ${capturedServerMode} to ${observedServerMode}`)
  }
  if (
    state?.server?.panel &&
    observed?.server?.healthy &&
    !observed.server.panel &&
    state.server.local
  ) {
    server.warnings.push('panel is no longer answering; only the local listener is healthy')
  }
  if (
    state?.server?.panel?.opencodeReachable &&
    observed?.server?.panel?.opencodeReachable === false
  ) {
    server.warnings.push('OpenCode became unreachable during the rebuild')
  }
  services.push(server)

  const web = serviceResult('web', state?.web?.expected, observed?.web)
  const capturedWebMode = state?.deployment?.web?.mode ?? state?.web?.mode
  const observedWebMode = observed?.web?.mode
  if (
    state?.web?.expected &&
    observed?.web?.healthy &&
    capturedWebMode &&
    observedWebMode &&
    capturedWebMode !== observedWebMode
  ) {
    web.warnings.push(`mode changed from ${capturedWebMode} to ${observedWebMode}`)
  }
  if (state?.web?.expected && capturedWebMode === 'local') {
    web.warnings.push('web is served outside this checkout')
  }
  services.push(web)

  const opencodeAdapter = {
    linked: adapter?.opencode?.linked === true,
    agentInstalled: adapter?.opencode?.agentInstalled === true,
    target: adapter?.opencode?.target ?? null,
    expectedTarget: state?.root ? `${state.root}/apps/adapters/opencode/plugin` : null,
  }
  if (opencodeAdapter.expectedTarget && opencodeAdapter.target) {
    if (!samePath(opencodeAdapter.target, opencodeAdapter.expectedTarget)) {
      warnings.push(
        `adapter points at ${opencodeAdapter.target}, not ${opencodeAdapter.expectedTarget}`
      )
    }
  }

  const mcp = {
    configured: adapter?.mcp?.configured === true,
    expected: state?.adapters?.mcp?.configured === true,
    configPath: adapter?.mcp?.configPath ?? null,
  }

  for (const service of services) {
    warnings.push(...service.warnings)
  }

  const selected =
    mode === 'all'
      ? services
      : services.filter(
          (service) => serviceMode(service.name, state, state?.[service.name]) === mode
        )

  const ok =
    selected.every((service) => !service.expected || service.healthy) &&
    opencodeAdapter.linked &&
    opencodeAdapter.agentInstalled &&
    (!mcp.expected || mcp.configured)

  return {
    ok,
    checkedAt: now.toISOString(),
    services: selected,
    adapters: { opencode: opencodeAdapter, mcp },
    warnings,
  }
}

export function summarizeHealth(report) {
  const lines = []
  for (const service of report.services) {
    const marker = service.expected ? (service.healthy ? 'ok' : 'fail') : 'skip'
    lines.push(`${marker.padEnd(4)} ${service.name.padEnd(12)} ${service.url ?? '-'}`)
  }
  lines.push(
    `${report.adapters.opencode.linked && report.adapters.opencode.agentInstalled ? 'ok' : 'fail'}   adapter      ${report.adapters.opencode.target ?? '-'}`
  )
  if (report.adapters.mcp.expected) {
    lines.push(
      `${report.adapters.mcp.configured ? 'ok' : 'fail'}   mcp          ${report.adapters.mcp.configPath ?? '-'}`
    )
  }
  for (const warning of report.warnings) lines.push(`warn ${warning}`)
  return lines
}
