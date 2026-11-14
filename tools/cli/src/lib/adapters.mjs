// Host-side adapter discovery, status, and lifecycle.
//
// Adapters are separate executables with their own config, log, and PID files
// under `clara/adapters/<name>`. The CLI never imports the adapter runtime; it
// reads those files and invokes the adapter's own `start`, `stop`, `install`,
// and `uninstall` commands.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { root, run } from './router.mjs'

export const HARNESSES = ['opencode', 'claude', 'pi']

export const HARNESS_LABELS = {
  opencode: 'OpenCode',
  claude: 'Claude Code',
  pi: 'Pi',
}

export function isHarness(value) {
  return HARNESSES.includes(value)
}

export function adapterPaths(name, env = process.env) {
  const configBase = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const dataBase = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  const configDir =
    env.CLARA_ADAPTER_CONFIG_DIR?.trim() || join(configBase, 'clara', 'adapters', name)
  const dataDir = env.CLARA_ADAPTER_DATA_DIR?.trim() || join(dataBase, 'clara', 'adapters', name)
  return {
    name,
    configDir,
    dataDir,
    configPath: join(configDir, 'config.json'),
    identityPath: join(dataDir, 'identity.json'),
    logPath: join(dataDir, 'adapter.log'),
    pidPath: join(dataDir, 'adapter.pid'),
    statePath: join(dataDir, 'state.json'),
  }
}

function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function readPid(path) {
  if (!existsSync(path)) return { running: false }
  const raw = readFileSync(path, 'utf8').trim()
  const pid = Number.parseInt(raw, 10)
  if (!Number.isInteger(pid) || pid <= 0) return { running: false }
  try {
    process.kill(pid, 0)
    return { running: true, pid }
  } catch (error) {
    return error?.code === 'EPERM' ? { running: true, pid } : { running: false }
  }
}

export function opencodeConfigPath(env = process.env) {
  const configBase = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(configBase, 'opencode', 'opencode.json')
}

export function mcpState(env = process.env) {
  const path = opencodeConfigPath(env)
  const config = readJson(path)
  const mcp = config && typeof config.mcp === 'object' && config.mcp !== null ? config.mcp : {}
  return {
    path,
    configured: Object.prototype.hasOwnProperty.call(mcp, 'clara'),
    api: Object.prototype.hasOwnProperty.call(mcp, 'clara-api'),
  }
}

export function adapterRecord(name, env = process.env) {
  const paths = adapterPaths(name, env)
  const config = readJson(paths.configPath)
  const identity = readJson(paths.identityPath)
  const state = readJson(paths.statePath)
  const process = readPid(paths.pidPath)
  const installed = Boolean(config)
  const running = installed && process.running
  const hub = running && state?.hub ? state.hub : undefined
  const harness = running && state?.harness ? state.harness : undefined
  const stale = Boolean(installed && !running && state)
  const mcp = name === 'opencode' ? mcpState(env) : undefined
  return {
    harness: name,
    label: HARNESS_LABELS[name] ?? name,
    installed,
    paired: installed,
    running,
    pid: process.pid ?? null,
    configPath: paths.configPath,
    logPath: paths.logPath,
    identityPath: paths.identityPath,
    harnessId: identity?.harnessId ?? null,
    hub: hub
      ? {
          url: hub.url,
          status: hub.status,
          connected: hub.connected === true,
          authenticated: hub.authenticated === true,
          lastError: hub.lastError ?? null,
        }
      : null,
    harnessHealth: harness
      ? {
          reachable: harness.reachable === true,
          version: harness.version ?? null,
          code: harness.code ?? null,
          checkedAt: harness.checkedAt ?? null,
          message: harness.message ?? null,
        }
      : null,
    stale,
    mcp,
    ok: installed && running && hub?.authenticated === true && harness?.reachable === true,
  }
}

export function installedHarnesses(env = process.env) {
  return HARNESSES.filter((name) => existsSync(adapterPaths(name, env).configPath))
}

/**
 * Resolve harness selections. An empty selection means every installed
 * adapter for lifecycle commands, and every supported adapter for status.
 */
export function selectHarnesses({ requested = [], installedOnly = true, env = process.env } = {}) {
  const expanded = requested.flatMap((value) =>
    String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  const installed = installedHarnesses(env)
  if (expanded.includes('all')) {
    return installedOnly ? installed : [...HARNESSES]
  }
  if (expanded.length === 0) {
    return installedOnly ? installed : [...HARNESSES]
  }
  const unknown = expanded.find((name) => !isHarness(name))
  if (unknown) throw new Error(`unknown harness: ${unknown}`)
  const selected = [...new Set(expanded)]
  return installedOnly ? selected.filter((name) => installed.includes(name)) : selected
}

export function resolveAdapterEntry(name, env = process.env) {
  const configured = env[`CLARA_ADAPTER_${name.toUpperCase()}_BIN`]?.trim()
  if (configured) return { command: configured, args: [] }
  const binary =
    process.platform === 'win32' ? `clara-adapter-${name}.cmd` : `clara-adapter-${name}`
  const onPath = findOnPath(binary, env)
  if (onPath) return { command: onPath, args: [] }
  const dist = join(root, 'apps', 'adapters', name, 'dist', 'index.js')
  if (existsSync(dist)) return { command: process.execPath, args: [dist] }
  const source = join(root, 'apps', 'adapters', name, 'src', 'index.ts')
  if (existsSync(source)) {
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', source],
    }
  }
  return undefined
}

export function runAdapter(name, commandArgs, env = process.env) {
  const entry = resolveAdapterEntry(name, env)
  if (!entry) {
    throw new Error(
      `The ${HARNESS_LABELS[name] ?? name} adapter command is not installed. Pass --pair to install it.`
    )
  }
  return run(entry.command, [...entry.args, ...commandArgs], { cwd: root })
}

function findOnPath(name, env) {
  const path = env.PATH ?? ''
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  for (const directory of path.split(delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

export function renderAdapterStatus(records, { json = false } = {}) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: records.every((record) => record.ok || (!record.installed && !record.running)),
          target: 'adapter',
          adapters: records,
        },
        null,
        2
      )
    )
    return
  }

  const headers = ['HARNESS', 'STATE', 'HUB', 'HARNESS', 'MCP', 'LOG']
  const rows = records.map((record) => [
    record.harness,
    record.installed ? (record.running ? `running (${record.pid})` : 'stopped') : 'not installed',
    record.hub
      ? record.hub.authenticated
        ? 'authenticated'
        : record.hub.connected
          ? 'connected'
          : (record.hub.lastError ?? 'disconnected')
      : record.stale
        ? 'stale'
        : '—',
    record.harnessHealth
      ? record.harnessHealth.reachable
        ? `reachable${record.harnessHealth.version ? ` ${record.harnessHealth.version}` : ''}`
        : 'unreachable'
      : '—',
    record.mcp
      ? record.mcp.configured
        ? record.mcp.api
          ? 'bridge+api'
          : 'bridge'
        : 'not configured'
      : '—',
    record.logPath,
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  )
  const line = (cells) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd()

  console.log('Clara adapters')
  console.log('')
  console.log(line(headers))
  for (const row of rows) console.log(line(row))

  const errors = records.filter(
    (record) =>
      record.installed &&
      (!record.running ||
        record.hub?.lastError ||
        (record.harnessHealth && !record.harnessHealth.reachable))
  )
  if (errors.length > 0) {
    console.log('')
    console.log('Issues')
    for (const record of errors) {
      if (!record.running) console.log(`  ${record.harness}: not running`)
      else if (record.hub?.lastError)
        console.log(`  ${record.harness}: hub ${record.hub.lastError}`)
      else if (record.harnessHealth?.message)
        console.log(`  ${record.harness}: ${record.harnessHealth.message}`)
      else console.log(`  ${record.harness}: harness is unreachable`)
    }
  }
}

export function adapterStatusExitCode(records) {
  return records.some((record) => record.installed && !record.ok) ? 1 : 0
}
