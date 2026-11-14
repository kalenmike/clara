import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireRuntimeLock,
  isRuntimeLive,
  readRuntimeState,
  runtimeFile,
  stopRuntimeState,
  writeRuntimeState,
} from '../src/index.mjs'

const dirs = []

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'clara-runtime-'))
  dirs.push(dir)
  return join(dir, 'runtime.json')
}

function state(patch = {}) {
  const now = new Date().toISOString()
  return {
    schema: 1,
    state: 'running',
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    version: '0.1.0',
    mode: 'local',
    configDir: '/tmp/config',
    dataDir: '/tmp/data',
    local: {
      host: '127.0.0.1',
      port: 54321,
      url: 'http://127.0.0.1:54321/',
      wsUrl: 'ws://127.0.0.1:54321/ws',
    },
    panel: { host: '127.0.0.1', port: 54322, url: 'http://127.0.0.1:54322/' },
    ...patch,
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.CLARA_RUNTIME_FILE
})

describe('runtime state', () => {
  it('honors CLARA_RUNTIME_FILE', () => {
    process.env.CLARA_RUNTIME_FILE = '/tmp/clara/custom.json'
    expect(runtimeFile()).toBe('/tmp/clara/custom.json')
  })

  it('writes and reads a running state', () => {
    const file = tempFile()
    writeRuntimeState(state(), file)
    const value = readRuntimeState(file)
    expect(value?.state).toBe('running')
    expect(value?.local?.wsUrl).toBe('ws://127.0.0.1:54321/ws')
    expect(isRuntimeLive(value)).toBe(true)
  })

  it('rejects malformed ports', () => {
    const file = tempFile()
    writeRuntimeState(state(), file)
    const raw = JSON.parse(JSON.stringify(state()))
    raw.panel.port = 0
    writeFileSync(file, JSON.stringify(raw))
    expect(readRuntimeState(file)).toBeUndefined()
  })

  it('keeps the ports as a hint after shutdown', () => {
    const file = tempFile()
    writeRuntimeState(state(), file)
    stopRuntimeState(file)
    const value = readRuntimeState(file)
    expect(value?.state).toBe('stopped')
    expect(value?.panel?.port).toBe(54322)
    expect(isRuntimeLive(value)).toBe(false)
  })

  it('serializes hub startup with a lock and replaces a stale lock', () => {
    const file = tempFile()
    const first = acquireRuntimeLock(file)
    expect(first.acquired).toBe(true)
    const second = acquireRuntimeLock(file)
    expect(second.acquired).toBe(false)
    expect(second.pid).toBe(process.pid)
    if (first.acquired) first.release()

    const lock = `${file}.lock`
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), '999999\n')
    const third = acquireRuntimeLock(file)
    expect(third.acquired).toBe(true)
    if (third.acquired) third.release()
  })
})
