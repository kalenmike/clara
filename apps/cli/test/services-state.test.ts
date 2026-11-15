import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  processAlive,
  readServicesState,
  removeServicesState,
  writeServicesState,
  type ServicesState,
} from '../src/state/services.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-state-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function state(): ServicesState {
  return {
    schemaVersion: 1,
    supervisor: { pid: process.pid, startedAt: new Date().toISOString(), services: ['hub'] },
    services: {
      hub: { pid: process.pid, state: 'running', port: 8790, restarts: 0 },
    },
    updatedAt: new Date().toISOString(),
  }
}

describe('services state', () => {
  it('writes and reads atomically', () => {
    const file = join(dir, 'services.json')
    writeServicesState(file, state())
    const value = readServicesState(file)
    expect(value?.services.hub?.port).toBe(8790)
    expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(1)
  })

  it('ignores malformed or unknown state', () => {
    const file = join(dir, 'services.json')
    writeFileSync(file, '{')
    expect(readServicesState(file)).toBeUndefined()
    writeFileSync(file, JSON.stringify({ schemaVersion: 99 }))
    expect(readServicesState(file)).toBeUndefined()
  })

  it('removes the state file', () => {
    const file = join(dir, 'services.json')
    writeServicesState(file, state())
    removeServicesState(file)
    expect(readServicesState(file)).toBeUndefined()
  })

  it('keeps the supervisor phase across a write', () => {
    const file = join(dir, 'services.json')
    writeServicesState(file, {
      ...state(),
      supervisor: { ...state().supervisor, state: 'stopping' },
    })
    expect(readServicesState(file)?.supervisor.state).toBe('stopping')
  })

  it('treats the current process as alive and rejects invalid pids', () => {
    expect(processAlive(process.pid)).toBe(true)
    expect(processAlive(0)).toBe(false)
    expect(processAlive(null)).toBe(false)
    expect(processAlive(999_999_999)).toBe(false)
  })
})
