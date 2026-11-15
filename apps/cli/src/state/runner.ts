import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { serviceLogPath, type ClaraPaths } from '../paths.ts'

export type RunnerProcess = {
  running: boolean
  pid?: number
}

export function runnerPidPath(paths: ClaraPaths): string {
  return join(paths.dataDir, 'runner.pid')
}

export function runnerLogPath(paths: ClaraPaths): string {
  return serviceLogPath(paths.dataDir, 'runner')
}

export function readRunnerPid(paths: ClaraPaths): number | undefined {
  const path = runnerPidPath(paths)
  if (!existsSync(path)) return undefined
  try {
    const value = Number.parseInt(text(path).trim(), 10)
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function writeRunnerPid(paths: ClaraPaths, pid: number): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  writeFileSync(runnerPidPath(paths), `${pid}\n`, { mode: 0o600 })
}

export function clearRunnerPid(paths: ClaraPaths): void {
  rmSync(runnerPidPath(paths), { force: true })
}

export function runnerProcess(paths: ClaraPaths): RunnerProcess {
  const pid = readRunnerPid(paths)
  if (pid === undefined) return { running: false }
  return isAlive(pid) ? { running: true, pid } : { running: false, pid }
}

/** Print the tail of the runner log, then optionally follow new lines. */
export async function followRunnerLog(options: {
  path: string
  lines: number
  follow: boolean
}): Promise<number> {
  if (!existsSync(options.path)) {
    console.error('No runner log yet. Start it with `clara runner start`.')
    return 1
  }
  for (const line of readTail(options.path).slice(-options.lines)) console.log(line)
  if (!options.follow) return 0

  let offset = size(options.path)
  let partial = ''
  const timer = setInterval(() => {
    const current = size(options.path)
    if (current < offset) {
      offset = 0
      partial = ''
    }
    if (current === offset) return
    const length = current - offset
    const buffer = Buffer.alloc(length)
    const fd = openSync(options.path, 'r')
    try {
      readSync(fd, buffer, 0, length, offset)
    } finally {
      closeQuietly(fd)
    }
    offset = current
    const lines = (partial + buffer.toString('utf8')).split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines) console.log(line)
  }, 300)

  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(timer)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

function readTail(path: string): string[] {
  const parts = text(path).split('\n')
  if (parts.at(-1) === '') parts.pop()
  return parts
}

function text(path: string): string {
  const length = size(path)
  if (length === 0) return ''
  const buffer = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, length, 0)
  } finally {
    closeQuietly(fd)
  }
  return buffer.toString('utf8')
}

function size(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // The descriptor is already closed.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
