import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'
import type { ServiceName } from '../src/ports.ts'
import { clearStaleStack, stopStack } from '../src/service/stop.ts'
import {
  processAlive,
  readServicesState,
  writeServicesState,
  type ServicesState,
} from '../src/state/services.ts'

const TIMINGS = {
  supervisorGraceMs: 500,
  supervisorKillMs: 2_000,
  childGraceMs: 500,
  childKillMs: 2_000,
}

const IGNORE_SIGNALS =
  "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000);process.send('ready')"
const EXIT_ON_SIGNAL =
  "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);process.send('ready')"

let dir: string
let paths: ClaraPaths
const spawned: ChildProcess[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-lifecycle-'))
  paths = resolvePaths({
    CLARA_CONFIG_DIR: join(dir, 'config'),
    CLARA_DATA_DIR: join(dir, 'data'),
    XDG_CACHE_HOME: join(dir, 'cache'),
  })
})

afterEach(async () => {
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  rmSync(dir, { recursive: true, force: true })
})

/** Start a stand-in service and wait until its signal handlers are installed. */
function start(code: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', code], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  spawned.push(child)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stand-in did not become ready')), 5_000)
    const settle = (): void => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const onMessage = (): void => {
      settle()
      resolve(child)
    }
    const onExit = (): void => {
      settle()
      reject(new Error('stand-in exited before it was ready'))
    }
    const onError = (cause: Error): void => {
      settle()
      reject(cause)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function deadProcess(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  spawned.push(child)
  const pid = child.pid
  if (pid === undefined) throw new Error('child has no pid')
  return new Promise((resolve, reject) => {
    child.once('exit', () => resolve(pid))
    child.once('error', reject)
  })
}

function writeState(
  supervisorPid: number,
  services: readonly { name: ServiceName; pid: number }[]
): void {
  const state: ServicesState = {
    schemaVersion: 1,
    supervisor: {
      pid: supervisorPid,
      startedAt: new Date().toISOString(),
      services: services.map(({ name }) => name),
    },
    services: Object.fromEntries(
      services.map(({ name, pid }) => [
        name,
        { pid, state: 'running' as const, port: 1, restarts: 0 },
      ])
    ),
    updatedAt: new Date().toISOString(),
  }
  writeServicesState(paths.stateFile, state)
  writeFileSync(paths.supervisorPidFile, `${supervisorPid}\n`)
}

describe('stopStack', () => {
  it('escalates the supervisor and cleans the children it left behind', async () => {
    const supervisor = await start(IGNORE_SIGNALS)
    const hub = await start(IGNORE_SIGNALS)
    writeState(supervisor.pid as number, [{ name: 'hub', pid: hub.pid as number }])

    const result = await stopStack(paths, undefined, { timings: TIMINGS })

    expect(result).toMatchObject({ code: 0, cleaned: ['hub'], survivors: [], escalated: true })
    expect(processAlive(supervisor.pid)).toBe(false)
    expect(processAlive(hub.pid)).toBe(false)
    expect(readServicesState(paths.stateFile)).toBeUndefined()
    expect(existsSync(paths.supervisorPidFile)).toBe(false)
    expect(existsSync(paths.stopRequestFile)).toBe(false)
  })

  it('stops a graceful supervisor without escalating', async () => {
    const supervisor = await start(EXIT_ON_SIGNAL)
    writeState(supervisor.pid as number, [])

    const result = await stopStack(paths, undefined, { timings: TIMINGS })

    expect(result).toMatchObject({ code: 0, survivors: [], escalated: false })
    expect(readServicesState(paths.stateFile)).toBeUndefined()
  })

  it('is a no-op on the second stop when no state remains', async () => {
    const supervisor = await start(IGNORE_SIGNALS)
    writeState(supervisor.pid as number, [])
    await stopStack(paths, undefined, { timings: TIMINGS })

    const again = await stopStack(paths, undefined, { timings: TIMINGS })

    expect(again).toMatchObject({ code: 0, cleaned: [], survivors: [], escalated: false })
  })

  it('refuses to stop one service of a multi-service stack', async () => {
    writeState(999_999, [
      { name: 'hub', pid: 999_998 },
      { name: 'web', pid: 999_997 },
    ])

    await expect(stopStack(paths, 'hub', { timings: TIMINGS })).rejects.toThrow(
      'supervised as one process'
    )
  })
})

describe('clearStaleStack', () => {
  it('stops services left behind by a dead supervisor', async () => {
    const supervisorPid = await deadProcess()
    const engine = await start(IGNORE_SIGNALS)
    writeState(supervisorPid, [{ name: 'engine', pid: engine.pid as number }])

    const result = await clearStaleStack(paths, { timings: TIMINGS })

    expect(result).toEqual({ ok: true, survivors: [] })
    expect(processAlive(engine.pid)).toBe(false)
    expect(readServicesState(paths.stateFile)).toBeUndefined()
  })

  it('clears stale files when nothing is left running', async () => {
    const supervisorPid = await deadProcess()
    writeState(supervisorPid, [])

    const result = await clearStaleStack(paths, { timings: TIMINGS })

    expect(result).toEqual({ ok: true, survivors: [] })
    expect(existsSync(paths.stateFile)).toBe(false)
  })
})
