// Shared constants and process helpers for the host-only Lab and docs targets.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, run, runPnpm } from './router.mjs'
import { buildInfoEnv } from './server-control.mjs'
import {
  logPath,
  processMatches,
  readPid,
  startDetached,
  stateDir,
  stopDetached,
} from './local-runtime.mjs'

export const LAB_NAME = 'lab'
export const DOCS_NAME = 'docs'

export function labPort(env = process.env) {
  const parsed = Number.parseInt(String(env.CLARA_LAB_PORT ?? readPort('lab', env) ?? '8791'), 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : 8791
}

export function docsPort(env = process.env) {
  const parsed = Number.parseInt(String(env.CLARA_DOCS_PORT ?? readPort('docs', env) ?? '5176'), 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : 5176
}

function readPort(name, env) {
  const path = join(stateDir(env), `${name}.port`)
  if (!existsSync(path)) return undefined
  try {
    const value = readFileSync(path, 'utf8').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

export function labURL(port = labPort()) {
  return `http://127.0.0.1:${port}/`
}

export function docsURL(port = docsPort()) {
  return `http://127.0.0.1:${port}/`
}

export function labLogPath() {
  return logPath(LAB_NAME)
}

export function docsLogPath() {
  return logPath(DOCS_NAME)
}

export function labEntry(repoRoot = root) {
  return join(repoRoot, 'tools', 'lab', 'dist', 'server', 'index.js')
}

export function labSource(repoRoot = root) {
  return join(repoRoot, 'tools', 'lab', 'server', 'index.ts')
}

export function labCommand(options = {}, repoRoot = root) {
  const entry = labEntry(repoRoot)
  if (existsSync(entry)) {
    return { command: process.execPath, args: [entry, 'serve', ...labArgs(options)] }
  }
  const source = labSource(repoRoot)
  if (existsSync(source)) {
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', source, 'serve', ...labArgs(options)],
    }
  }
  return undefined
}

export function labCheckCommand(options = {}, repoRoot = root) {
  const entry = labEntry(repoRoot)
  if (existsSync(entry)) {
    return { command: process.execPath, args: [entry, 'check', ...labArgs(options)] }
  }
  const source = labSource(repoRoot)
  if (existsSync(source)) {
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', source, 'check', ...labArgs(options)],
    }
  }
  return undefined
}

export function labArgs(options = {}) {
  const args = []
  if (options.workspace) args.push('--workspace', options.workspace)
  if (options.target) args.push('--target', options.target)
  if (options.config) args.push('--config', options.config)
  if (options.port) args.push('--port', String(options.port))
  if (options.open === false) args.push('--no-open')
  if (options.json) args.push('--json')
  return args
}

export function docsArgs(options = {}) {
  const args = ['--filter', '@clara/docs', 'exec', 'docusaurus']
  if (options.preview) {
    args.push('serve', '--host', '127.0.0.1', '--port', String(options.port ?? docsPort()))
  } else {
    args.push('start', '--host', '127.0.0.1', '--port', String(options.port ?? docsPort()))
    if (options.open === false) args.push('--no-open')
  }
  return args
}

export function docsCommand(options = {}) {
  return { command: runPnpmCommand(), args: docsArgs(options) }
}

function runPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

export function buildLab(repoRoot = root) {
  return runPnpm(['--filter', '@clara/lab-cli', 'build'], { cwd: repoRoot })
}

export function buildDocs(repoRoot = root) {
  return runPnpm(['--filter', '@clara/docs', 'build'], { cwd: repoRoot })
}

export function typecheckDocs(repoRoot = root) {
  return runPnpm(['--filter', '@clara/docs', 'typecheck'], { cwd: repoRoot })
}

export async function labHealthy(port = labPort()) {
  try {
    const token = process.env.CLARA_LAB_TOKEN?.trim()
    const response = await fetch(`${labURL(port)}api/health`, {
      signal: AbortSignal.timeout(1_500),
      cache: 'no-store',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    })
    if (!response.ok) return false
    const body = await response.json()
    return body?.service === 'clara-lab'
  } catch {
    return false
  }
}

export async function docsHealthy(port = docsPort()) {
  try {
    const response = await fetch(docsURL(port), {
      signal: AbortSignal.timeout(1_500),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export async function startLab(options = {}, repoRoot = root) {
  const command = labCommand(options, repoRoot)
  if (!command) throw new Error('Clara Lab is not built. Run `pnpm build` first.')
  return startDetached({
    name: LAB_NAME,
    command: command.command,
    args: command.args,
    cwd: repoRoot,
    env: { ...process.env, ...buildInfoEnv(repoRoot) },
    healthy: () => labHealthy(options.port ?? labPort()),
    timeoutMs: 60_000,
  })
}

export async function startDocs(options = {}, repoRoot = root) {
  const command = docsCommand(options)
  return startDetached({
    name: DOCS_NAME,
    command: command.command,
    args: command.args,
    cwd: repoRoot,
    healthy: () => docsHealthy(options.port ?? docsPort()),
    timeoutMs: 120_000,
  })
}

export async function stopLab() {
  return stopDetached({
    name: LAB_NAME,
    patterns: ['clara-lab', 'tools/lab'],
    ports: [labPort()],
    discover: async () => {
      const pid = readPid(LAB_NAME)
      return pid.pid === null ? [] : [{ pid: pid.pid, source: 'pid file', trusted: true }]
    },
  })
}

export async function stopDocs() {
  return stopDetached({
    name: DOCS_NAME,
    patterns: ['docusaurus'],
    ports: [docsPort()],
    discover: async () => {
      const pid = readPid(DOCS_NAME)
      return pid.pid === null ? [] : [{ pid: pid.pid, source: 'pid file', trusted: true }]
    },
  })
}

export function docsProcessRunning() {
  const pid = readPid(DOCS_NAME)
  if (pid.alive) return { running: true, pid: pid.pid }
  return { running: false }
}

export function labProcessRunning() {
  const pid = readPid(LAB_NAME)
  if (pid.alive) return { running: true, pid: pid.pid }
  return { running: false }
}

export function isDocsProcess(pid) {
  return processMatches(pid, ['docusaurus'])
}

export function runLabCheck(options = {}, repoRoot = root) {
  const command = labCheckCommand(options, repoRoot)
  if (!command) throw new Error('Clara Lab is not built. Run `pnpm build` first.')
  return run(command.command, command.args, { cwd: repoRoot })
}
