import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'
import {
  clearRunnerPid,
  followRunnerLog,
  readRunnerPid,
  runnerLogPath,
  runnerPidPath,
  runnerProcess,
  writeRunnerPid,
} from '../src/state/runner.ts'

const roots: string[] = []

function tempPaths(): ClaraPaths {
  const root = mkdtempSync(join(tmpdir(), 'clara-runner-state-'))
  roots.push(root)
  return resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('runner state', () => {
  it('writes and clears the pid file under the data directory', () => {
    const paths = tempPaths()
    writeRunnerPid(paths, process.pid)
    expect(runnerPidPath(paths)).toBe(join(paths.dataDir, 'runner.pid'))
    expect(readRunnerPid(paths)).toBe(process.pid)
    expect(runnerProcess(paths).running).toBe(true)
    clearRunnerPid(paths)
    expect(readRunnerPid(paths)).toBeUndefined()
    expect(runnerProcess(paths)).toEqual({ running: false })
  })

  it('treats a dead pid as stopped and keeps the recorded pid', () => {
    const paths = tempPaths()
    writeRunnerPid(paths, 2_147_483_647)
    expect(runnerProcess(paths)).toEqual({ running: false, pid: 2_147_483_647 })
  })

  it('ignores an invalid pid file', () => {
    const paths = tempPaths()
    writeRunnerPid(paths, process.pid)
    writeFileSync(runnerPidPath(paths), 'nope')
    expect(readRunnerPid(paths)).toBeUndefined()
    expect(runnerProcess(paths)).toEqual({ running: false })
  })
})

describe('runner logs', () => {
  it('prints the requested tail without following', async () => {
    const paths = tempPaths()
    writeRunnerPid(paths, process.pid)
    mkdirSync(paths.logDir, { recursive: true })
    writeFileSync(runnerLogPath(paths), 'one\ntwo\nthree\n')
    const lines: string[] = []
    const original = console.log
    console.log = (...parts: unknown[]) => lines.push(parts.map(String).join(' '))
    try {
      const code = await followRunnerLog({
        path: runnerLogPath(paths),
        lines: 2,
        follow: false,
      })
      expect(code).toBe(0)
    } finally {
      console.log = original
    }
    expect(lines).toEqual(['two', 'three'])
  })

  it('reports a missing log', async () => {
    const paths = tempPaths()
    const errors: string[] = []
    const original = console.error
    console.error = (...parts: unknown[]) => errors.push(parts.map(String).join(' '))
    try {
      const code = await followRunnerLog({
        path: runnerLogPath(paths),
        lines: 10,
        follow: false,
      })
      expect(code).toBe(1)
    } finally {
      console.error = original
    }
    expect(errors.join('\n')).toContain('No runner log yet')
  })
})
