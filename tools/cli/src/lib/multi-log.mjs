// Follow several logs at once.
//
// Core service, adapter, and runner logs are files. The runner can also follow
// a systemd journal child. Both paths share the same line prefixing so a
// combined view is readable.

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

class PrefixedWriter {
  constructor(prefix, write = process.stdout.write.bind(process.stdout)) {
    this.prefix = prefix
    this.write = write
    this.pending = ''
  }

  push(text) {
    this.pending += text
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    for (const line of lines) this.write(`${this.prefix}${line}\n`)
  }

  flush() {
    if (!this.pending) return
    this.write(`${this.prefix}${this.pending}\n`)
    this.pending = ''
  }
}

function tail(text, lines) {
  const entries = text.split('\n')
  if (entries.length > 0 && entries[entries.length - 1] === '') entries.pop()
  return entries.slice(-lines)
}

function readFrom(path, offset) {
  const stat = statSync(path)
  if (stat.size <= offset) return { text: '', size: stat.size }
  const buffer = Buffer.alloc(stat.size - offset)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, offset)
  } finally {
    closeSync(fd)
  }
  return { text: buffer.toString('utf8'), size: stat.size }
}

export async function followFiles(entries, { lines = 80, follow = true } = {}) {
  const writers = new Map()
  const offsets = new Map()
  for (const entry of entries) {
    const writer = new PrefixedWriter(`[${entry.name}] `)
    writers.set(entry.name, writer)
    if (!existsSync(entry.path)) {
      process.stdout.write(`[${entry.name}] no log at ${entry.path}\n`)
      offsets.set(entry.name, 0)
      continue
    }
    const text = readFileText(entry.path)
    for (const line of tail(text, lines)) writer.push(`${line}\n`)
    offsets.set(entry.name, Buffer.byteLength(text))
  }

  if (!follow) {
    for (const writer of writers.values()) writer.flush()
    return
  }

  const timer = setInterval(() => {
    for (const entry of entries) {
      if (!existsSync(entry.path)) continue
      const offset = offsets.get(entry.name) ?? 0
      const result = readFrom(entry.path, offset)
      if (result.text) writers.get(entry.name)?.push(result.text)
      offsets.set(entry.name, result.size)
    }
  }, 500)

  await waitForInterrupt()
  clearInterval(timer)
  for (const writer of writers.values()) writer.flush()
}

function readFileText(path) {
  const stat = statSync(path)
  const buffer = Buffer.alloc(stat.size)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, 0)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

export async function followCommands(entries, { follow = true, cwd, env = process.env } = {}) {
  const children = []
  const writers = new Map()
  for (const entry of entries) {
    const writer = new PrefixedWriter(`[${entry.name}] `)
    writers.set(entry.name, writer)
    const child = spawn(entry.command, entry.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    const forward = (chunk) => writer.push(String(chunk))
    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
  }

  let interrupted = false
  const stop = () => {
    if (interrupted) return
    interrupted = true
    for (const child of children) child.kill('SIGINT')
  }
  process.once('SIGINT', stop)

  try {
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            child.once('error', () => resolve())
            child.once('exit', () => {
              if (!follow && !interrupted) return resolve()
              resolve()
            })
          })
      )
    )
  } finally {
    process.removeListener('SIGINT', stop)
    for (const writer of writers.values()) writer.flush()
  }
}

async function waitForInterrupt() {
  await new Promise((resolve) => {
    const stop = () => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
