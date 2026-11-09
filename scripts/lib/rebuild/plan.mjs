// Pure planning and health evaluation for the rebuild lifecycle.
//
// Keeping these functions independent of the filesystem and process table
// makes the restart order and the health verdict easy to test.

export const SERVICE_ORDER = ['lab', 'control', 'orchestrator']

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

export function restartPlan(state, { skip = [], manageExternal = false } = {}) {
  const skipped = new Set(skip)
  const services = []
  const warnings = []

  for (const name of SERVICE_ORDER) {
    const captured = state?.[name]
    if (skipped.has(name)) {
      services.push({ name, action: 'skip', reason: 'skipped by flag' })
      continue
    }
    if (!captured?.expected) {
      services.push({ name, action: 'skip', reason: 'not running when captured' })
      continue
    }
    if (name === 'orchestrator' && captured.external && !manageExternal) {
      services.push({ name, action: 'skip', reason: 'managed outside this checkout' })
      warnings.push(
        `orchestrator at ${captured.url} is external; pass --manage-external to restart it`
      )
      continue
    }
    services.push({ name, action: 'restart', reason: 'running when captured' })
  }

  return { services, warnings }
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

export function evaluateHealth(state, observed, { adapter, now = new Date() } = {}) {
  const services = []
  const warnings = []

  const orchestrator = serviceResult(
    'orchestrator',
    state?.orchestrator?.expected,
    observed?.orchestrator
  )
  if (
    state?.orchestrator?.expected &&
    observed?.orchestrator?.healthy &&
    observed.orchestrator.mode !== state.orchestrator.mode
  ) {
    orchestrator.warnings.push(
      `mode changed from ${state.orchestrator.mode} to ${observed.orchestrator.mode}`
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

  const control = serviceResult('control', state?.control?.expected, observed?.control)
  if (
    state?.control?.panel &&
    observed?.control?.healthy &&
    !observed.control.panel &&
    state.control.local
  ) {
    control.warnings.push('panel is no longer answering; only the local listener is healthy')
  }
  if (
    state?.control?.panel?.opencodeReachable &&
    observed?.control?.panel?.opencodeReachable === false
  ) {
    control.warnings.push('OpenCode became unreachable during the rebuild')
  }
  services.push(control)

  const opencodeAdapter = {
    linked: adapter?.opencode?.linked === true,
    agentInstalled: adapter?.opencode?.agentInstalled === true,
    target: adapter?.opencode?.target ?? null,
    expectedTarget: state?.root ? `${state.root}/plugins/clara-policy` : null,
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

  const ok =
    services.every((service) => !service.expected || service.healthy) &&
    opencodeAdapter.linked &&
    opencodeAdapter.agentInstalled &&
    (!mcp.expected || mcp.configured)

  return {
    ok,
    checkedAt: now.toISOString(),
    services,
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
