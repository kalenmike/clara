import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearStopRequest, readStopRequest, writeStopRequest } from '../src/state/stop-request.ts'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-stop-request-'))
  file = join(dir, 'stop.request')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('stop request', () => {
  it('round-trips a request for a supervisor pid', () => {
    writeStopRequest(file, {
      schemaVersion: 1,
      supervisorPid: 4242,
      requestedAt: '2026-01-01T00:00:00.000Z',
      requestedBy: 'cli 7',
    })
    expect(readStopRequest(file)).toEqual({
      schemaVersion: 1,
      supervisorPid: 4242,
      requestedAt: '2026-01-01T00:00:00.000Z',
      requestedBy: 'cli 7',
    })
  })

  it('ignores a missing, malformed, or unknown request', () => {
    expect(readStopRequest(file)).toBeUndefined()
    writeFileSync(file, '{')
    expect(readStopRequest(file)).toBeUndefined()
    writeFileSync(file, JSON.stringify({ schemaVersion: 2, supervisorPid: 1 }))
    expect(readStopRequest(file)).toBeUndefined()
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, supervisorPid: 0 }))
    expect(readStopRequest(file)).toBeUndefined()
  })

  it('keeps the pid and falls back for a missing timestamp', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, supervisorPid: 9 }))
    const request = readStopRequest(file)
    expect(request?.supervisorPid).toBe(9)
    expect(Number.isNaN(Date.parse(request?.requestedAt ?? ''))).toBe(false)
  })

  it('writes atomically without leaving the temp file behind', () => {
    writeStopRequest(file, {
      schemaVersion: 1,
      supervisorPid: 1,
      requestedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(JSON.parse(readFileSync(file, 'utf8')).supervisorPid).toBe(1)
    expect(() => readFileSync(`${file}.${process.pid}.tmp`)).toThrow()
  })

  it('clears the request', () => {
    writeStopRequest(file, {
      schemaVersion: 1,
      supervisorPid: 1,
      requestedAt: '2026-01-01T00:00:00.000Z',
    })
    clearStopRequest(file)
    expect(readStopRequest(file)).toBeUndefined()
  })
})
