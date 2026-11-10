import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { RunnerHttpError } from './client.ts'
import type { ScriptSpec, ScriptWorkOrder } from './types.ts'

const DEFAULT_TIMEOUT_SECONDS = 900
const DEFAULT_MAX_OUTPUT = 64 * 1024
const OUTPUT_FLUSH_MS = 250
const KILL_GRACE_MS = 5_000

/** Environment keys a script gets without opting in through `passEnv`. */
const BASE_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
]

export interface RunnerTransport {
  heartbeat(order: ScriptWorkOrder): Promise<unknown>
  output(order: ScriptWorkOrder, stream: 'stdout' | 'stderr', chunk: string): Promise<unknown>
  complete(order: ScriptWorkOrder, result: unknown, exitCode: number): Promise<unknown>
  fail(order: ScriptWorkOrder, error: string, exitCode?: number): Promise<unknown>
}

export interface ExecuteOptions {
  heartbeatMs?: number
  logger?: { warn(message: string): void }
}

export type ExecuteOutcome =
  | { ok: true; exitCode: number }
  | { ok: false; exitCode?: number; reason: string; lostLease?: boolean }

function commandFor(spec: ScriptSpec): { file: string; args: string[] } {
  const shell = spec.interpreter?.trim()
  if (!shell) {
    return process.platform === 'win32'
      ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', spec.command] }
      : { file: '/bin/sh', args: ['-c', spec.command] }
  }
  const name = basename(shell).toLowerCase()
  if (name === 'cmd' || name === 'cmd.exe') {
    return { file: shell, args: ['/d', '/s', '/c', spec.command] }
  }
  if (
    name === 'powershell' ||
    name === 'pwsh' ||
    name === 'powershell.exe' ||
    name === 'pwsh.exe'
  ) {
    return { file: shell, args: ['-NoProfile', '-Command', spec.command] }
  }
  return { file: shell, args: ['-c', spec.command] }
}

function scriptEnv(
  spec: ScriptSpec,
  workspace: string,
  files: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of BASE_ENV) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  for (const key of spec.passEnv ?? []) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return {
    ...env,
    ...(spec.env ?? {}),
    CLARA_WORKSPACE: workspace,
    ...files,
  }
}

function materialize(order: ScriptWorkOrder, temp: string): Record<string, string> {
  const files: Record<string, string> = {}
  const inputIndex: Record<string, string> = {}
  for (const input of order.context.inputs) {
    const name = input.label.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    const target = join(temp, `input-${input.label.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
    writeFileSync(target, JSON.stringify(input.result ?? null, null, 2))
    files[`CLARA_INPUT_${name}`] = target
    inputIndex[input.label] = target
  }
  const index = join(temp, 'inputs.json')
  writeFileSync(index, JSON.stringify(inputIndex, null, 2))
  files.CLARA_INPUTS = index

  const artifacts = join(temp, 'artifacts.json')
  writeFileSync(artifacts, JSON.stringify(order.context.artifacts, null, 2))
  files.CLARA_ARTIFACTS = artifacts

  const request = join(temp, 'request.txt')
  writeFileSync(request, order.context.prompt ?? '')
  files.CLARA_REQUEST = request
  files.CLARA_RUN_ID = String(order.run_id)
  files.CLARA_STEP_PATH = order.step_path
  return files
}

function resolveCwd(order: ScriptWorkOrder): string {
  const workspace = resolve(order.workspace)
  if (!order.script.cwd) return workspace
  const target = isAbsolute(order.script.cwd)
    ? resolve(order.script.cwd)
    : resolve(workspace, order.script.cwd)
  const rel = relative(workspace, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`script cwd escapes the workspace: ${order.script.cwd}`)
  }
  return target
}

function trim(value: string, limit: number): string {
  if (Buffer.byteLength(value) <= limit) return value
  const buffer = Buffer.from(value)
  return `${buffer.subarray(0, limit).toString('utf8')}\n…[truncated]`
}

function normalizeResult(
  spec: ScriptSpec,
  stdout: string,
  stderr: string,
  exitCode: number
): unknown {
  const limit = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
  const out = trim(stdout, limit)
  const err = trim(stderr, limit)
  const mode = spec.resultMode ?? 'auto'
  if (mode === 'text') return out
  if (mode === 'exit') return { exit_code: exitCode }
  if (mode === 'tail') return { exit_code: exitCode, tail: out }
  if (mode === 'json') {
    const text = stdout.trim()
    if (!text) throw new Error('script produced no JSON on stdout')
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('script stdout is not JSON')
    }
  }
  if (mode === 'auto') {
    const text = stdout.trim()
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        // Fall through to the raw result.
      }
    }
  }
  return { exit_code: exitCode, stdout: out, stderr: err }
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    if (child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    }
    return
  }
  try {
    process.kill(-child.pid!, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, KILL_GRACE_MS).unref()
}

/**
 * Execute one script work order and report it to the orchestrator. The caller
 * owns registration and claiming; this function owns the process, the lease
 * heartbeat, output streaming, and the terminal complete/fail call.
 */
export async function executeScript(
  client: RunnerTransport,
  order: ScriptWorkOrder,
  options: ExecuteOptions = {}
): Promise<ExecuteOutcome> {
  const spec = order.script
  const temp = mkdtempSync(join(tmpdir(), 'clara-runner-'))
  mkdirSync(temp, { recursive: true })
  let child: ChildProcess | undefined
  let lostLease = false
  let timedOut = false
  let stdout = ''
  let stderr = ''
  let pendingOut = ''
  let pendingErr = ''
  const limit = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT

  const flush = (): void => {
    const out = pendingOut
    const err = pendingErr
    pendingOut = ''
    pendingErr = ''
    if (out) void client.output(order, 'stdout', out).catch(() => {})
    if (err) void client.output(order, 'stderr', err).catch(() => {})
  }

  const flushTimer = setInterval(flush, OUTPUT_FLUSH_MS)
  const heartbeatMs = options.heartbeatMs ?? 10_000
  let heartbeatFailures = 0
  const heartbeat = setInterval(() => {
    void client
      .heartbeat(order)
      .then(() => {
        heartbeatFailures = 0
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // A lease rejection is final. A network or service error can be a
        // deliberate orchestrator restart, so keep the child alive through a
        // short outage instead of killing a rebuild mid-restart.
        const rejected =
          error instanceof RunnerHttpError && error.status >= 400 && error.status < 500
        heartbeatFailures += 1
        if (rejected || heartbeatFailures >= 6) {
          lostLease = true
          options.logger?.warn(`lost lease for ${order.step_path}: ${message}`)
          if (child) killTree(child)
        } else {
          options.logger?.warn(`heartbeat delayed for ${order.step_path}: ${message}`)
        }
      })
  }, heartbeatMs)

  try {
    const cwd = resolveCwd(order)
    const files = materialize(order, temp)
    const env = scriptEnv(spec, order.workspace, files)
    const command = commandFor(spec)
    const timeoutMs = (spec.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000

    const outcome = await new Promise<ExecuteOutcome>((resolveOutcome) => {
      let settled = false
      const finish = (value: ExecuteOutcome): void => {
        if (settled) return
        settled = true
        resolveOutcome(value)
      }

      try {
        child = spawn(command.file, command.args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: process.platform !== 'win32',
        })
      } catch (error) {
        finish({ ok: false, reason: `could not start ${command.file}: ${String(error)}` })
        return
      }

      const timeout = setTimeout(() => {
        timedOut = true
        if (child) killTree(child)
      }, timeoutMs)

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        if (Buffer.byteLength(stdout) < limit) stdout += text
        pendingOut += text
      })
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        if (Buffer.byteLength(stderr) < limit) stderr += text
        pendingErr += text
      })
      child.on('error', (error) => {
        clearTimeout(timeout)
        finish({ ok: false, reason: `script process error: ${error.message}` })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timeout)
        const exitCode = code ?? (signal ? 1 : 0)
        if (lostLease) {
          finish({ ok: false, reason: 'runner lost the step lease', exitCode, lostLease: true })
          return
        }
        if (timedOut) {
          finish({ ok: false, reason: `script timed out after ${timeoutMs / 1000}s`, exitCode })
          return
        }
        finish({ ok: true, exitCode })
      })
    })

    flush()
    if (!outcome.ok && outcome.lostLease) return outcome
    if (!outcome.ok) {
      await client
        .fail(order, outcome.reason, outcome.exitCode)
        .catch((error: unknown) => options.logger?.warn(String(error)))
      return outcome
    }
    const successCodes = spec.successCodes ?? [0]
    if (!successCodes.includes(outcome.exitCode)) {
      const reason = `script exited with ${outcome.exitCode}${stderr.trim() ? `: ${stderr.trim().slice(-2000)}` : ''}`
      await client
        .fail(order, reason, outcome.exitCode)
        .catch((error: unknown) => options.logger?.warn(String(error)))
      return { ok: false, exitCode: outcome.exitCode, reason }
    }
    const result = normalizeResult(spec, stdout, stderr, outcome.exitCode)
    await client
      .complete(order, result, outcome.exitCode)
      .catch((error: unknown) => options.logger?.warn(String(error)))
    return outcome
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!lostLease) {
      await client
        .fail(order, reason)
        .catch((cause: unknown) => options.logger?.warn(String(cause)))
    }
    return { ok: false, reason, ...(lostLease ? { lostLease: true } : {}) }
  } finally {
    clearInterval(flushTimer)
    clearInterval(heartbeat)
    if (child && child.exitCode === null && child.signalCode === null) killTree(child)
    rmSync(temp, { recursive: true, force: true })
  }
}
