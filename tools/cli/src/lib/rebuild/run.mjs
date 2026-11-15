// Implementations for `clara rebuild`.
//
// `status` captures the live setup, `build` and `adapters` do the rebuild, and
// `restart`/`health` restore and verify the captured set. The restart is
// deliberately ordered lab -> server -> orchestrator so the orchestrator that
// owns the running pipeline is the last thing to go down.

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  dataDir,
  appendLog,
  ensureRebuildDir,
  isSnapshotStale,
  journalPath,
  logPath,
  readJournal,
  readState,
  statePath,
  tail,
  writeJournal,
  writeState,
} from './state.mjs'
import {
  canSignal,
  findListenerPid,
  labPorts,
  localPort,
  orchestratorURL,
  panelPort,
  probeServer,
  probeLab,
  probeLabPort,
  probeOrchestrator,
  probeWeb,
  processMatches,
  readProcessEnv,
  readToken,
  waitForExit,
  waitForProbe,
  webPort,
} from './probe.mjs'
import {
  deploymentModes,
  evaluateHealth,
  parseWorktreeList,
  primaryWorktree,
  recoveryPlan,
  restartPlan,
  summarizeHealth,
} from './plan.mjs'
import { serverRunningInCompose } from '../server-control.mjs'
import { webRunningInCompose } from '../web-control.mjs'

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const DEFAULT_PROGRESS = (text) => process.stderr.write(text)

/* -------------------------------------------------------------------------- */
/* Commands and repository discovery                                          */
/* -------------------------------------------------------------------------- */

function runStreaming(command, args, { cwd, env = process.env, log, progress } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    let output = ''
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const consume = (chunk) => {
      const text = chunk.toString()
      output = tail(output + text, 8000)
      if (log) log(text.trimEnd())
      if (progress) progress(text)
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.once('error', (error) => {
      resolvePromise({
        ok: false,
        code: null,
        signal: null,
        output,
        error: error.message,
        durationMs: Date.now() - started,
      })
    })
    child.once('exit', (code, signal) => {
      resolvePromise({ ok: code === 0, code, signal, output, durationMs: Date.now() - started })
    })
  })
}

function runCli(args, options) {
  return runStreaming(PNPM, ['clara', ...args], options)
}

function spawnDetached(command, args, { cwd, env, logFile }) {
  ensureRebuildDir()
  const out = openSync(logFile, 'a', 0o600)
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', out, out],
    })
    child.unref()
    return child.pid
  } finally {
    closeSync(out)
  }
}

function logCommand(line) {
  appendLog(process.env, line)
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0) return undefined
  return result.stdout.trim()
}

export function gitSnapshot(root) {
  const head = gitOutput(['rev-parse', 'HEAD'], root)
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], root)
  const status = gitOutput(['status', '--porcelain'], root)
  return {
    available: head !== undefined,
    branch: branch || undefined,
    head: head || undefined,
    dirty: status === undefined ? undefined : status.length > 0,
  }
}

export function resolveRepository({ root, cwd = process.cwd() } = {}) {
  const requested = root ? resolve(cwd, root) : undefined
  const listOutput = gitOutput(['worktree', 'list', '--porcelain'], requested ?? cwd)
  const worktrees = parseWorktreeList(listOutput ?? '')
  const primary = primaryWorktree(worktrees)
  const resolvedRoot = requested ?? primary ?? cwd
  return { root: resolvedRoot, primary, worktrees, invokedFrom: cwd }
}

function pnpmVersion() {
  const result = spawnSync(PNPM, ['--version'], { encoding: 'utf8', timeout: 5000 })
  return result.status === 0 ? result.stdout.trim() : undefined
}

export function adapterSnapshot(root, env = process.env) {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const link = join(configHome, 'opencode', 'plugins', 'clara-policy')
  const agent = join(configHome, 'opencode', 'agents', 'clara.md')
  const configPath = join(configHome, 'opencode', 'opencode.json')

  let linked = false
  let target = null
  try {
    const info = lstatSync(link)
    linked = true
    target = info.isSymbolicLink() ? resolve(dirname(link), readlinkSync(link)) : link
  } catch {
    // Missing links are expected before the adapters step.
  }

  return {
    opencode: {
      linked,
      link,
      target,
      agentInstalled: existsSync(agent),
      agentPath: agent,
      expectedTarget: join(root, 'apps', 'adapters', 'opencode', 'plugin'),
    },
    mcp: {
      configured: mcpConfigured(configPath),
      configPath,
    },
  }
}

function mcpConfigured(path) {
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    return Boolean(config?.mcp?.clara)
  } catch {
    return false
  }
}

function requireState(path) {
  const selected = path ?? statePath()
  const state = readState(selected)
  if (!state) {
    throw new Error(`no rebuild snapshot at ${selected}; run \`clara rebuild status\` first`)
  }
  return state
}

/* -------------------------------------------------------------------------- */
/* status                                                                     */
/* -------------------------------------------------------------------------- */

export async function runStatus(options = {}) {
  const repo = resolveRepository({ root: options.root })
  const root = repo.root
  const webCompose = webRunningInCompose(root)
  const [orchestrator, lab, server, web] = await Promise.all([
    probeOrchestrator({ url: options.orchestratorURL ?? orchestratorURL() }),
    probeLab({ ports: labPorts() }),
    probeServer({ panelPort: panelPort(), localPort: localPort() }),
    probeWeb({ port: webPort(), container: webCompose }),
  ])

  const state = {
    schema: 1,
    createdAt: new Date().toISOString(),
    root,
    installRoot: root,
    invokedFrom: repo.invokedFrom,
    worktrees: repo.worktrees,
    git: gitSnapshot(root),
    runtime: {
      node: process.version,
      pnpm: pnpmVersion(),
      platform: process.platform,
      arch: process.arch,
    },
    environment: {
      dataDir: dataDir(),
      orchestratorURL: orchestratorURL(),
      labPort: labPorts()[0] ?? null,
      panelPort: panelPort(),
      localPort: localPort(),
      webPort: webPort(),
    },
    orchestrator,
    lab,
    server,
    web: { ...web, expected: web.expected || webCompose },
    adapters: adapterSnapshot(root),
  }
  const deployment = deploymentModes({
    orchestrator,
    lab,
    server,
    web,
    compose: { server: serverRunningInCompose(root), web: webCompose },
  })
  state.deployment = deployment
  state.orchestrator = { ...orchestrator, mode: deployment.orchestrator.mode }
  state.server = {
    ...server,
    mode: deployment.server.mode,
    container: deployment.server.container,
  }
  state.lab = { ...lab, mode: deployment.lab.mode }
  state.web = {
    ...web,
    expected: web.expected || webCompose,
    mode: deployment.web.mode,
    container: deployment.web.container,
  }

  writeState(state, options.statePath)
  return state
}

export function formatStatus(state) {
  const git = state.git?.available
    ? `${state.git.branch ?? 'detached'} @ ${(state.git.head ?? '').slice(0, 8)}${
        state.git.dirty ? ' (dirty)' : ' (clean)'
      }`
    : 'not a git checkout'
  const lines = [
    `root:         ${state.root}`,
    `git:          ${git}`,
    `orchestrator: ${describeService(state.orchestrator)}`,
    `lab:          ${describeService(state.lab)}`,
    `hub:          ${describeService(state.server)}`,
    `web:          ${describeService(state.web)}`,
    `adapter:      ${state.adapters.opencode.linked ? 'linked' : 'missing'} ${
      state.adapters.opencode.target ?? ''
    }`.trimEnd(),
    `mcp:          ${state.adapters.mcp.configured ? 'configured' : 'not configured'}`,
  ]
  if (state.worktrees?.length && state.root !== state.worktrees[0].path) {
    lines.push(`note:         building ${state.root} instead of the primary checkout`)
  }
  lines.push(`snapshot:     ${statePath()}`)
  return lines
}

function describeService(service) {
  if (!service?.expected) return `stopped (${service?.state ?? 'unknown'})`
  const url = service.url ?? ''
  if (service.port) {
    const suffix = service.connected === false ? ', disconnected' : ''
    return `running ${url}${suffix}`
  }
  const mode = service.mode ?? service.state ?? ''
  const external = service.external ? ', external' : ''
  return `running ${url} (${mode}${external})`
}

/* -------------------------------------------------------------------------- */
/* build                                                                      */
/* -------------------------------------------------------------------------- */

export async function runBuild(options = {}) {
  const state = requireState(options.statePath)
  const root = options.root ? resolve(options.root) : state.root
  const progress = options.progress ?? DEFAULT_PROGRESS
  const steps = [
    { name: 'install', args: ['install', '--frozen-lockfile'] },
    { name: 'build', args: ['build'] },
  ]
  const results = []

  for (const step of steps) {
    logCommand(`$ pnpm ${step.args.join(' ')} (cwd ${root})`)
    const result = await runStreaming(PNPM, step.args, {
      cwd: root,
      progress,
      log: (text) => appendLog(process.env, text),
    })
    results.push({
      name: step.name,
      command: `pnpm ${step.args.join(' ')}`,
      ok: result.ok,
      code: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      output: tail(result.output, 4000),
    })
    if (!result.ok) break
  }

  const ok = results.length === steps.length && results.every((result) => result.ok)
  state.root = root
  state.installRoot = root
  state.build = {
    finishedAt: new Date().toISOString(),
    ok,
    results,
  }
  writeState(state, options.statePath)
  return { ok, root, results, snapshot: options.statePath ?? statePath() }
}

export function formatBuild(result) {
  const lines = result.results.map(
    (step) =>
      `${step.ok ? 'ok  ' : 'fail'} ${step.name.padEnd(8)} ${step.durationMs}ms  ${step.command}`
  )
  lines.push(`build: ${result.ok ? 'ok' : 'failed'}`)
  return lines
}

/* -------------------------------------------------------------------------- */
/* adapters                                                                   */
/* -------------------------------------------------------------------------- */

export async function runAdapters(options = {}) {
  const state = requireState(options.statePath)
  const root = options.root ? resolve(options.root) : (state.installRoot ?? state.root)
  const progress = options.progress ?? DEFAULT_PROGRESS
  const results = []

  const install = await runCommandStep(
    'adapter',
    ['clara', 'adapter', 'install', 'opencode', '--no-daemon'],
    {
      root,
      progress,
    }
  )
  results.push(install)

  const wantsMcp =
    options.mcp === true || (options.mcp !== false && state.adapters?.mcp?.configured === true)
  if (wantsMcp) {
    const mcp = await runCommandStep('mcp', ['clara', 'mcp', 'install', '--no-start'], {
      root,
      progress,
    })
    results.push(mcp)
  }

  const adapters = adapterSnapshot(root)
  state.installRoot = root
  state.adapters = adapters
  state.adaptersUpdatedAt = new Date().toISOString()
  writeState(state, options.statePath)

  const ok =
    results.every((result) => result.ok) &&
    adapters.opencode.linked &&
    adapters.opencode.agentInstalled &&
    (!wantsMcp || adapters.mcp.configured)

  return { ok, root, results, adapters, snapshot: options.statePath ?? statePath() }
}

async function runCommandStep(name, args, { root, progress }) {
  logCommand(`$ pnpm ${args.join(' ')} (cwd ${root})`)
  const result = await runStreaming(PNPM, args, {
    cwd: root,
    progress,
    log: (text) => appendLog(process.env, text),
  })
  return {
    name,
    command: `pnpm ${args.join(' ')}`,
    ok: result.ok,
    code: result.code,
    signal: result.signal,
    durationMs: result.durationMs,
    output: tail(result.output, 4000),
  }
}

export function formatAdapters(result) {
  const lines = result.results.map(
    (step) => `${step.ok ? 'ok  ' : 'fail'} ${step.name.padEnd(8)} ${step.command}`
  )
  lines.push(
    `adapter: ${result.adapters.opencode.linked ? 'linked' : 'missing'} ${result.adapters.opencode.target ?? ''}`
  )
  lines.push(`agent:   ${result.adapters.opencode.agentInstalled ? 'installed' : 'missing'}`)
  lines.push(`mcp:     ${result.adapters.mcp.configured ? 'configured' : 'not configured'}`)
  lines.push(`adapters: ${result.ok ? 'ok' : 'failed'}`)
  return lines
}

/* -------------------------------------------------------------------------- */
/* restart                                                                    */
/* -------------------------------------------------------------------------- */

export async function runRestart(options = {}) {
  const selectedStatePath = options.statePath ?? statePath()
  const selectedJournalPath = options.journalPath ?? journalPath()
  const state = requireState(selectedStatePath)
  if (isSnapshotStale(state) && !options.force) {
    throw new Error(
      `snapshot ${selectedStatePath} is older than two hours; run \`clara rebuild status\` again`
    )
  }

  const plan = restartPlan(state, {
    skip: options.skip ?? [],
    manageExternal: options.manageExternal === true,
    ...(options.only ? { only: options.only } : {}),
    mode: options.mode ?? 'all',
  })
  if (options.dryRun) {
    return {
      dryRun: true,
      ok: true,
      plan,
      snapshot: selectedStatePath,
      journal: selectedJournalPath,
    }
  }

  const previous = readJournal(selectedJournalPath)
  const sameSnapshot = previous?.stateCreatedAt === state.createdAt
  if (!options.ignoreJournal && sameSnapshot && previous.status === 'complete' && !options.force) {
    return {
      ok: true,
      resumed: true,
      plan,
      completed: previous.completed ?? [],
      errors: [],
      note: 'restart already completed; verify health',
      snapshot: selectedStatePath,
      journal: selectedJournalPath,
    }
  }

  const completed = sameSnapshot ? [...(previous?.completed ?? [])] : []
  const errors = []
  const running = plan.services
    .filter((service) => service.action === 'restart')
    .map((service) => service.name)

  if (sameSnapshot && previous.status === 'restarting' && !options.force) {
    logCommand('restart journal found; resuming only services that were not marked complete')
  }

  const journal = {
    status: 'restarting',
    startedAt: sameSnapshot ? previous.startedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stateCreatedAt: state.createdAt,
    services: plan.services,
    completed: [...completed],
    errors: [...(sameSnapshot ? (previous.errors ?? []) : [])],
  }
  writeJournal(journal, selectedJournalPath)

  for (const name of running) {
    if (completed.includes(name)) continue
    try {
      logCommand(`restarting ${name}`)
      await restartService(name, state, options)
      completed.push(name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ service: name, message })
      logCommand(`restart ${name} failed: ${message}`)
    }
    journal.completed = [...completed]
    journal.errors = [...errors]
    journal.updatedAt = new Date().toISOString()
    writeJournal(journal, selectedJournalPath)
  }

  const ok = errors.length === 0
  journal.status = ok ? 'complete' : 'failed'
  journal.finishedAt = new Date().toISOString()
  writeJournal(journal, selectedJournalPath)

  state.lastRestart = {
    finishedAt: journal.finishedAt,
    ok,
    completed,
    errors,
  }
  writeState(state, selectedStatePath)

  return {
    ok,
    plan,
    completed,
    errors,
    snapshot: selectedStatePath,
    journal: selectedJournalPath,
    log: logPath(),
  }
}

/* -------------------------------------------------------------------------- */
/* inspect                                                                    */
/* -------------------------------------------------------------------------- */

export async function runInspect(options = {}) {
  const selectedStatePath = options.statePath ?? statePath()
  const state = readState(selectedStatePath)
  if (!state) {
    return {
      available: false,
      reason: `no rebuild snapshot at ${selectedStatePath}`,
      snapshot: { path: selectedStatePath },
      deployment: null,
      log: { path: logPath(), tail: '' },
    }
  }
  const selectedJournalPath = options.journalPath ?? journalPath()
  const journal = readJournal(selectedJournalPath)
  const health = await runHealth({ ...options, statePath: selectedStatePath })
  const plan = restartPlan(state, { skip: options.skip ?? [] })
  const completed = new Set(journal?.completed ?? [])
  const pending = plan.services
    .filter((service) => service.action === 'restart' && !completed.has(service.name))
    .map((service) => service.name)
  const created = Date.parse(state.createdAt ?? '')
  const ageMs = Number.isFinite(created) ? Date.now() - created : null
  return {
    available: true,
    snapshot: {
      path: selectedStatePath,
      createdAt: state.createdAt ?? null,
      ageMs,
      stale: isSnapshotStale(state),
      root: state.root ?? null,
      installRoot: state.installRoot ?? state.root ?? null,
      git: state.git ?? null,
      environment: state.environment ?? null,
    },
    deployment:
      state.deployment ??
      deploymentModes({
        orchestrator: state.orchestrator,
        lab: state.lab,
        server: state.server,
        web: state.web,
        compose: {
          server: serverRunningInCompose(state.installRoot ?? state.root),
          web: webRunningInCompose(state.installRoot ?? state.root),
        },
      }),
    journal: {
      path: selectedJournalPath,
      status: journal?.status ?? null,
      updatedAt: journal?.updatedAt ?? null,
      completed: journal?.completed ?? [],
      errors: journal?.errors ?? [],
    },
    plan,
    pending,
    health,
    log: { path: logPath(), tail: readLogTail(options.lines) },
  }
}

function readLogTail(lines) {
  try {
    return tail(readFileSync(logPath(), 'utf8'), lines ?? 4000)
  } catch {
    return ''
  }
}

export function formatInspect(result) {
  if (!result.available) return [result.reason]
  const lines = [
    `snapshot   ${result.snapshot.path} (${result.snapshot.stale ? 'stale' : 'fresh'})`,
    `root       ${result.snapshot.root ?? '-'}`,
    `modes      hub ${result.deployment?.server?.mode ?? 'unknown'}, orchestrator ${
      result.deployment?.orchestrator?.mode ?? 'unknown'
    }${result.deployment?.orchestrator?.external ? ' external' : ''}, lab ${
      result.deployment?.lab?.mode ?? 'unknown'
    }, web ${result.deployment?.web?.mode ?? 'unknown'}`,
    `journal    ${result.journal.status ?? 'none'}`,
  ]
  if (result.pending.length) lines.push(`pending    ${result.pending.join(', ')}`)
  lines.push(...summarizeHealth(result.health))
  if (result.log.tail) lines.push(`log tail   ${result.log.path}`)
  return lines
}

/* -------------------------------------------------------------------------- */
/* recover                                                                    */
/* -------------------------------------------------------------------------- */

export async function runRecover(options = {}) {
  const selectedStatePath = options.statePath ?? statePath()
  const selectedJournalPath = options.journalPath ?? journalPath()
  const state = requireState(selectedStatePath)
  if (isSnapshotStale(state) && !options.force) {
    throw new Error(
      `snapshot ${selectedStatePath} is older than two hours; run \`clara rebuild status\` again`
    )
  }

  const before = await runHealth({ ...options, statePath: selectedStatePath })
  const plan = recoveryPlan(state, before, {
    skip: options.skip ?? [],
    manageExternal: options.manageExternal === true,
    mode: options.mode ?? 'all',
  })
  if (!plan.only.length) {
    return {
      ok: before.ok,
      unchanged: true,
      plan,
      recovered: [],
      errors: [],
      health: before,
      snapshot: selectedStatePath,
      journal: selectedJournalPath,
    }
  }

  const restart = await runRestart({
    ...options,
    statePath: selectedStatePath,
    journalPath: selectedJournalPath,
    only: plan.only,
    ignoreJournal: true,
  })
  const failed = new Set((restart.errors ?? []).map((error) => error.service))
  const health = await runHealth({ ...options, statePath: selectedStatePath })
  return {
    ok: restart.ok && health.ok,
    unchanged: false,
    plan,
    attempted: plan.only,
    recovered: plan.only.filter((name) => !failed.has(name)),
    errors: restart.errors ?? [],
    health,
    snapshot: selectedStatePath,
    journal: selectedJournalPath,
  }
}

export function formatRecover(result) {
  if (result.unchanged) {
    return [
      `recovery: nothing to restart (${result.health.ok ? 'healthy' : 'health still failing'})`,
      ...summarizeHealth(result.health),
    ]
  }
  const lines = [`recovered  ${result.recovered.length ? result.recovered.join(', ') : 'none'}`]
  for (const error of result.errors) lines.push(`fail       ${error.service}: ${error.message}`)
  lines.push(...summarizeHealth(result.health))
  lines.push(`recovery: ${result.ok ? 'ok' : 'failed'}`)
  return lines
}

async function restartService(name, state, options) {
  if (name === 'web') return restartWeb(state, options)
  if (name === 'lab') return restartLab(state, options)
  if (name === 'server') return restartServer(state, options)
  if (name === 'orchestrator') return restartOrchestrator(state, options)
  throw new Error(`unknown service: ${name}`)
}

async function restartWeb(state, options) {
  const web = state.web
  const root = state.installRoot ?? state.root
  const mode = state.deployment?.web?.mode ?? web.mode ?? 'container'
  if (mode === 'local') {
    logCommand('stopping the local web client')
    const stop = await runCli(['web', 'stop', '--local'], {
      cwd: root,
      progress: options.progress ?? DEFAULT_PROGRESS,
      log: (text) => appendLog(process.env, text),
    })
    if (!stop.ok) {
      throw new Error(`local web stop failed (exit ${stop.code ?? 'unknown'})`)
    }
    logCommand('starting the local web client')
    const start = await runCli(['web', 'start', '--local'], {
      cwd: root,
      progress: options.progress ?? DEFAULT_PROGRESS,
      log: (text) => appendLog(process.env, text),
    })
    if (!start.ok) {
      throw new Error(`local web start failed (exit ${start.code ?? 'unknown'})`)
    }
    const port = web.port ?? webPort()
    const result = await waitForProbe(
      () => probeWeb({ port, container: false }),
      (probe) => probe.expected && probe.healthy,
      { timeoutMs: 300_000 }
    )
    if (!result.ok) {
      throw new Error(`web did not become healthy at ${web.url ?? `http://127.0.0.1:${port}`}`)
    }
    return
  }

  logCommand('stopping web through docker compose')
  const stop = await runCli(['web', 'stop', '--docker'], {
    cwd: root,
    progress: options.progress ?? DEFAULT_PROGRESS,
    log: (text) => appendLog(process.env, text),
  })
  if (!stop.ok) {
    throw new Error(`web container stop failed (exit ${stop.code ?? 'unknown'})`)
  }
  logCommand('starting web through docker compose')
  const start = await runCli(['web', 'start', '--docker', '--build'], {
    cwd: root,
    progress: options.progress ?? DEFAULT_PROGRESS,
    log: (text) => appendLog(process.env, text),
  })
  if (!start.ok) {
    throw new Error(`web container start failed (exit ${start.code ?? 'unknown'})`)
  }
  const port = web.port ?? webPort()
  const result = await waitForProbe(
    () => probeWeb({ port, container: true }),
    (probe) => probe.expected && probe.healthy,
    { timeoutMs: 300000 }
  )
  if (!result.ok) {
    throw new Error(`web did not become healthy at ${web.url ?? `http://127.0.0.1:${port}`}`)
  }
}

async function restartLab(state, options) {
  const lab = state.lab
  const port = lab.port
  const current = await probeLabPort(port)
  if (
    current.expected &&
    lab.workspace &&
    current.workspace &&
    current.workspace !== lab.workspace
  ) {
    if (!options.force) {
      throw new Error(
        `lab on port ${port} now serves ${current.workspace}, not ${lab.workspace}; run \`clara rebuild status\` again or pass --force`
      )
    }
  }
  if (!current.expected && current.state === 'foreign') {
    throw new Error(`port ${port} is used by another service; the lab was not restarted`)
  }

  const pid = current.expected ? (current.pid ?? findListenerPid(port)) : lab.pid
  if (pid && canSignal(pid) && processMatches(pid, ['tools/lab', 'clara-lab']) !== false) {
    process.kill(pid, 'SIGTERM')
    if (!(await waitForExit(pid, 10000))) {
      process.kill(pid, 'SIGKILL')
      await waitForExit(pid, 3000)
    }
  } else if (current.expected) {
    throw new Error(`lab at ${lab.url} did not expose a live pid; restart it manually once`)
  }

  const root = lab.root ?? state.root
  const dist = join(root, 'apps', 'lab', 'dist', 'server', 'index.js')
  const source = join(root, 'apps', 'lab', 'server', 'index.ts')
  const useDist = existsSync(dist)
  const entry = useDist ? dist : source
  if (!existsSync(entry)) throw new Error(`lab entry not found under ${root}`)

  const args = [
    ...(useDist ? [] : ['--experimental-strip-types', '--no-warnings']),
    entry,
    'serve',
    '--port',
    String(port),
    '--workspace',
    lab.workspace ?? root,
    '--no-open',
  ]
  const env = { ...process.env, CLARA_LAB_OPEN: '0', CLARA_LAB_PORT: String(port) }
  if (lab.orchestrator) env.CLARA_ORCHESTRATION_URL = lab.orchestrator
  const token = readToken(process.env)
  if (token) env.CLARA_ORCHESTRATION_TOKEN = token

  logCommand(`starting lab on ${port} from ${root}`)
  spawnDetached(process.execPath, args, { cwd: root, env, logFile: logPath() })

  const result = await waitForProbe(
    () => probeLabPort(port),
    (probe) => probe.expected && probe.healthy,
    { timeoutMs: 30000 }
  )
  if (!result.ok) throw new Error(`lab did not become healthy at ${lab.url}`)
}

async function restartServer(state, options) {
  const server = state.server
  const buildRoot = state.installRoot ?? state.root
  let mode = state.deployment?.server?.mode ?? server.mode
  if (!mode || mode === 'stopped') {
    mode = serverRunningInCompose(buildRoot) ? 'container' : 'local'
  }
  if (mode === 'container') {
    await restartServerContainer(buildRoot, server, options)
    return
  }
  if (server.systemd === true) {
    logCommand('restarting server through systemctl --user restart clara')
    const result = await runStreaming('systemctl', ['--user', 'restart', 'clara'], {
      progress: options.progress ?? DEFAULT_PROGRESS,
      log: (text) => appendLog(process.env, text),
    })
    if (!result.ok) {
      throw new Error(`systemctl --user restart clara failed (exit ${result.code ?? 'unknown'})`)
    }
    await waitForServer(server)
    return
  }

  const current = await probeServer({
    panelPort: server.panelPort,
    localPort: server.localPort,
  })
  if (current.mode === 'container') {
    if (!options.force) {
      throw new Error(
        'the snapshot captured a local hub but it is running in a container; stop the container or re-capture with `clara rebuild status`'
      )
    }
    await restartServerContainer(buildRoot, server, options)
    return
  }
  const pid = current.expected
    ? (current.pid ?? findListenerPid(current.panelPort) ?? findListenerPid(current.localPort))
    : server.pid
  if (pid && canSignal(pid) && processMatches(pid, ['apps/hub/server', 'clara-server']) !== false) {
    const env = readProcessEnv(pid) ?? { ...process.env }
    process.kill(pid, 'SIGTERM')
    if (!(await waitForExit(pid, 10000))) {
      process.kill(pid, 'SIGKILL')
      await waitForExit(pid, 3000)
    }
    return startServer(state, server, env)
  }
  if (current.expected) {
    throw new Error('the hub did not expose a restartable pid; restart it manually')
  }

  return startServer(state, server, { ...process.env })
}

async function restartServerContainer(buildRoot, server, options) {
  logCommand('stopping server through docker compose')
  const stop = await runCli(['server', 'stop', '--docker'], {
    cwd: buildRoot,
    progress: options.progress ?? DEFAULT_PROGRESS,
    log: (text) => appendLog(process.env, text),
  })
  if (!stop.ok) {
    throw new Error(`server container stop failed (exit ${stop.code ?? 'unknown'})`)
  }
  logCommand('starting server through docker compose')
  const start = await runCli(['server', 'start', '--docker', '--build'], {
    cwd: buildRoot,
    progress: options.progress ?? DEFAULT_PROGRESS,
    log: (text) => appendLog(process.env, text),
  })
  if (!start.ok) {
    throw new Error(`server container start failed (exit ${start.code ?? 'unknown'})`)
  }
  await waitForServer(server)
}

async function startServer(state, server, env) {
  const root = state.installRoot ?? state.root
  const entry = join(root, 'apps', 'hub', 'server', 'dist', 'index.js')
  if (!existsSync(entry)) throw new Error(`agent entry not found at ${entry}`)
  const args = [entry]
  if (!server.panel) args.push('--no-panel')

  logCommand(`starting server from ${root}`)
  spawnDetached(process.execPath, args, { cwd: root, env, logFile: logPath() })
  await waitForServer(server)
}

async function waitForServer(server) {
  const expectedPanel = Boolean(server.panel)
  const expectedLocal = Boolean(server.local)
  const result = await waitForProbe(
    () => probeServer({ panelPort: server.panelPort, localPort: server.localPort }),
    (probe) =>
      probe.expected &&
      probe.healthy &&
      (!expectedPanel || Boolean(probe.panel)) &&
      (!expectedLocal || Boolean(probe.local)),
    { timeoutMs: 30000 }
  )
  if (!result.ok) throw new Error('the hub did not become healthy')
}

async function restartOrchestrator(state, options) {
  const orchestrator = state.orchestrator
  if (orchestrator.external && options.manageExternal !== true) {
    throw new Error(
      `orchestrator at ${orchestrator.url} is external; pass --manage-external to restart it`
    )
  }

  const root = state.installRoot ?? state.root
  const env = { ...process.env, CLARA_DATA_DIR: dataDir() }
  if (orchestrator.workspace) env.CLARA_ORCHESTRATION_WORKSPACE = orchestrator.workspace
  if (orchestrator.configPath) env.CLARA_ORCHESTRATION_CONFIG = orchestrator.configPath

  if (orchestrator.mode === 'local') {
    const url = new URL(orchestrator.url)
    env.CLARA_ORCHESTRATION_HOST = url.hostname
    env.CLARA_ORCHESTRATION_PORT = url.port || '8789'
    await runCli(['orchestrator', 'stop'], { cwd: root, env, progress: options.progress })
    const start = await runCli(['orchestrator', 'start'], {
      cwd: root,
      env,
      progress: options.progress,
      log: (text) => appendLog(process.env, text),
    })
    if (!start.ok) throw new Error(`orchestrator start failed (exit ${start.code ?? 'unknown'})`)
  } else {
    env.CLARA_WORKSPACE = orchestrator.workspace ?? root
    const token = readToken(process.env)
    if (token) env.CLARA_ORCHESTRATION_TOKEN = token
    await runCli(['orchestrator', 'stop', '--docker'], {
      cwd: root,
      env,
      progress: options.progress,
    })
    const start = await runCli(['orchestrator', 'start', '--docker', '--build'], {
      cwd: root,
      env,
      progress: options.progress,
      log: (text) => appendLog(process.env, text),
    })
    if (!start.ok)
      throw new Error(`orchestrator container start failed (exit ${start.code ?? 'unknown'})`)
  }

  const result = await waitForProbe(
    () => probeOrchestrator({ url: orchestrator.url, token: readToken(process.env) }),
    (probe) => probe.expected && probe.healthy,
    { timeoutMs: orchestrator.mode === 'container' ? 300000 : 60000 }
  )
  if (!result.ok) throw new Error(`orchestrator did not become healthy at ${orchestrator.url}`)

  if (
    orchestrator.mode === 'local' &&
    orchestrator.pid &&
    result.value.pid &&
    result.value.pid === orchestrator.pid
  ) {
    throw new Error('orchestrator health returned the old pid; it did not restart')
  }
}

export function formatRestart(result) {
  if (result.dryRun) {
    const lines = ['restart plan (dry run):']
    for (const service of result.plan.services) {
      lines.push(
        `  ${service.action.padEnd(8)} ${service.name.padEnd(12)} ${(service.mode ?? '').padEnd(9)} ${service.reason}`
      )
    }
    for (const warning of result.plan.warnings) lines.push(`  warn     ${warning}`)
    return lines
  }
  const lines = [`restart: ${result.ok ? 'ok' : 'failed'}`]
  if (result.resumed) lines.push(`note:     ${result.note}`)
  if (result.completed?.length) lines.push(`restarted: ${result.completed.join(', ')}`)
  const skipped = result.plan.services
    .filter((service) => service.action === 'skip')
    .map((service) => `${service.name} (${service.reason}, ${service.mode ?? 'unknown'})`)
  if (skipped.length) lines.push(`skipped:   ${skipped.join(', ')}`)
  for (const error of result.errors ?? []) {
    lines.push(`error:    ${error.service}: ${error.message}`)
  }
  for (const warning of result.plan.warnings) lines.push(`warn:     ${warning}`)
  if (result.journal) lines.push(`journal:  ${result.journal}`)
  return lines
}

/* -------------------------------------------------------------------------- */
/* health                                                                     */
/* -------------------------------------------------------------------------- */

export async function runHealth(options = {}) {
  const state = requireState(options.statePath)
  const webContainer = webRunningInCompose(state.installRoot ?? state.root)
  const [orchestrator, lab, server, web] = await Promise.all([
    state.orchestrator?.expected
      ? probeOrchestrator({ url: state.orchestrator?.url || orchestratorURL() })
      : { expected: false, healthy: false, state: 'stopped' },
    state.lab?.expected
      ? probeLab({ ports: state.lab?.port ? [state.lab.port] : labPorts() })
      : { expected: false, healthy: false, state: 'stopped' },
    state.server?.expected
      ? probeServer({
          panelPort: state.server?.panelPort ?? panelPort(),
          localPort: state.server?.localPort ?? localPort(),
        })
      : { expected: false, healthy: false, state: 'stopped' },
    state.web?.expected
      ? probeWeb({ port: state.web?.port ?? webPort(), container: webContainer })
      : { expected: false, healthy: false, state: 'stopped' },
  ])
  const adapter = adapterSnapshot(state.installRoot ?? state.root)
  const report = evaluateHealth(
    state,
    { orchestrator, lab, server, web },
    { adapter, mode: options.mode ?? 'all' }
  )
  report.snapshot = options.statePath ?? statePath()
  return report
}

export { summarizeHealth }
