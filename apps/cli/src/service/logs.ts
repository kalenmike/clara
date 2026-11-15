import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { serviceLogPath, type ClaraPaths } from '../paths.ts'
import type { ServiceName } from '../ports.ts'
import { cyan, dim, green, magenta, yellow } from '../ui/color.ts'

type LogFile = { name: ServiceName; path: string; offset: number; partial: string }

export async function followLogs(options: {
  paths: ClaraPaths
  services: readonly ServiceName[]
  lines: number
  follow: boolean
}): Promise<number> {
  const files: LogFile[] = options.services.map((name) => ({
    name,
    path: serviceLogPath(options.paths.dataDir, name),
    offset: 0,
    partial: '',
  }))
  const existing = files.filter((file) => existsSync(file.path))
  if (existing.length === 0) {
    console.error('No service logs yet. Start the stack with `clara start`.')
    return 1
  }

  for (const file of existing) {
    const tail = readTail(file.path, options.lines)
    for (const line of tail) process.stdout.write(`${prefix(file.name)} ${line}\n`)
    file.offset = file.path ? size(file.path) : 0
  }
  if (!options.follow) return 0

  const timer = setInterval(() => pump(files), 300)
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

function pump(files: LogFile[]): void {
  for (const file of files) {
    if (!existsSync(file.path)) continue
    const current = size(file.path)
    if (current < file.offset) {
      file.offset = 0
      file.partial = ''
    }
    if (current === file.offset) continue
    const length = current - file.offset
    const buffer = Buffer.alloc(length)
    const fd = openSync(file.path, 'r')
    try {
      readSync(fd, buffer, 0, length, file.offset)
    } finally {
      closeQuietly(fd)
    }
    file.offset = current
    const text = file.partial + buffer.toString('utf8')
    const parts = text.split('\n')
    file.partial = parts.pop() ?? ''
    for (const line of parts) process.stdout.write(`${prefix(file.name)} ${line}\n`)
  }
}

function readTail(path: string, lines: number): string[] {
  const text = readAll(path)
  const parts = text.split('\n')
  if (parts.at(-1) === '') parts.pop()
  return parts.slice(-lines)
}

function readAll(path: string): string {
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
    // Ignore a descriptor that is already closed.
  }
}

function prefix(name: ServiceName): string {
  if (name === 'hub') return cyan(dim('[hub]'))
  if (name === 'engine') return magenta(dim('[engine]'))
  if (name === 'web') return green(dim('[web]'))
  return yellow(dim(`[${name}]`))
}
