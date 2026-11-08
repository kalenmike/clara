import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pidPath } from '../src/config.ts'
import {
  collectStatus,
  composeArgs,
  formatStatus,
  readPidState,
  startDockerService,
  statusExitCode,
  stopService,
  type HealthProbe,
} from '../src/lifecycle.ts'

interface FakeService {
  port: number
  close(): Promise<void>
}

let dataDir: string
let saved: Record<string, string | undefined>

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function fakeService(payload: unknown): Promise<FakeService> {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function writePid(pid: number): void {
  writeFileSync(pidPath(), `${pid}\n`)
}

function deadPid(): number {
  for (let pid = 900_000; pid < 901_000; pid += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return pid
    }
  }
  throw new Error('could not find a free pid')
}

beforeEach(() => {
  saved = {
    CLARA_DATA_DIR: process.env.CLARA_DATA_DIR,
    CLARA_ORCHESTRATION_HOST: process.env.CLARA_ORCHESTRATION_HOST,
    CLARA_ORCHESTRATION_PORT: process.env.CLARA_ORCHESTRATION_PORT,
    CLARA_ORCHESTRATION_CONTAINER: process.env.CLARA_ORCHESTRATION_CONTAINER,
  }
  dataDir = mkdtempSync(join(tmpdir(), 'clara-orchestrator-'))
  setEnv('CLARA_DATA_DIR', dataDir)
  setEnv('CLARA_ORCHESTRATION_HOST', '127.0.0.1')
  setEnv('CLARA_ORCHESTRATION_CONTAINER', undefined)
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) setEnv(key, value)
  rmSync(dataDir, { recursive: true, force: true })
})

describe('orchestrator lifecycle', () => {
  it('reports stopped when nothing is listening', async () => {
    setEnv('CLARA_ORCHESTRATION_PORT', String(await freePort()))

    const report = await collectStatus()
    expect(report.state).toBe('stopped')
    expect(report.pid).toBeNull()
    expect(report.stalePid).toBeNull()
    expect(statusExitCode(report)).toBe(1)
    expect(formatStatus(report)).toContain('service: stopped')
  })

  it('reports a docker container without claiming a local pid', async () => {
    const service = await fakeService({
      ok: true,
      service: 'clara-orchestrator',
      mode: 'container',
    })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    try {
      const report = await collectStatus()
      expect(report.state).toBe('container')
      expect(report.pid).toBeNull()
      expect(statusExitCode(report)).toBe(0)
      const lines = formatStatus(report)
      expect(lines).toContain('service: running (docker container)')
      expect(lines).toContain('pid: none (managed by the container)')
      expect(lines).toContain('stop: pnpm clara orchestration stop --docker')
    } finally {
      await service.close()
    }
  })

  it('reports a local instance from its pid file', async () => {
    const service = await fakeService({
      ok: true,
      service: 'clara-orchestrator',
      mode: 'local',
      pid: process.pid,
    })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    writePid(process.pid)
    try {
      const report = await collectStatus()
      expect(report.state).toBe('local')
      expect(report.pid).toBe(process.pid)
      expect(report.pidAlive).toBe(true)
      expect(statusExitCode(report)).toBe(0)
      expect(formatStatus(report)).toContain('service: running (local)')
    } finally {
      await service.close()
    }
  })

  it('does not treat a different local pid as the responding service', async () => {
    const service = await fakeService({
      ok: true,
      service: 'clara-orchestrator',
      mode: 'local',
      pid: process.pid + 1,
    })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    writePid(process.pid)
    try {
      expect((await collectStatus()).state).toBe('external')
      expect(await stopService()).toEqual({ kind: 'external' })
      expect(existsSync(pidPath())).toBe(true)
    } finally {
      await service.close()
    }
  })

  it('treats an untracked local service as external', async () => {
    const service = await fakeService({ ok: true, service: 'clara-orchestrator', mode: 'local' })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    try {
      const report = await collectStatus()
      expect(report.state).toBe('external')
      expect(report.pid).toBeNull()
      expect(statusExitCode(report)).toBe(0)
      expect(formatStatus(report)).toContain(
        'warning: no local pid file; this instance was not started from this data directory'
      )
    } finally {
      await service.close()
    }
  })

  it('reports a live local process that is not answering', async () => {
    setEnv('CLARA_ORCHESTRATION_PORT', String(await freePort()))
    writePid(process.pid)

    const report = await collectStatus()
    expect(report.state).toBe('unresponsive')
    expect(report.pid).toBe(process.pid)
    expect(statusExitCode(report)).toBe(1)
    expect(formatStatus(report)).toContain(
      `service: not responding (local pid ${process.pid} is alive)`
    )
  })

  it('rejects another service on the port', async () => {
    const service = await fakeService({ ok: true, service: 'not-clara' })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    try {
      const report = await collectStatus()
      expect(report.state).toBe('foreign')
      expect(statusExitCode(report)).toBe(1)
      expect(formatStatus(report)).toContain(
        'service: not running (another service is using the port)'
      )
    } finally {
      await service.close()
    }
  })

  it('will not stop a container without an explicit docker request', async () => {
    const service = await fakeService({
      ok: true,
      service: 'clara-orchestrator',
      mode: 'container',
    })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    try {
      expect(await stopService()).toEqual({ kind: 'container' })
    } finally {
      await service.close()
    }
  })

  it('runs compose down for a container when asked', async () => {
    const service = await fakeService({
      ok: true,
      service: 'clara-orchestrator',
      mode: 'container',
    })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    let invocations = 0
    try {
      const result = await stopService({
        docker: true,
        composeDown: async () => {
          invocations += 1
          return { ok: true, code: 0 }
        },
      })
      expect(invocations).toBe(1)
      expect(result).toEqual({ kind: 'container-down', result: { ok: true, code: 0 } })
    } finally {
      await service.close()
    }
  })

  it('removes a stale pid file without signalling anything', async () => {
    setEnv('CLARA_ORCHESTRATION_PORT', String(await freePort()))
    const pid = deadPid()
    writePid(pid)

    const result = await stopService()
    expect(result).toEqual({ kind: 'already-stopped', stalePid: pid })
    expect(existsSync(pidPath())).toBe(false)
  })

  it('terminates a live local process and removes the pid file', async () => {
    setEnv('CLARA_ORCHESTRATION_PORT', String(await freePort()))
    const child: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    if (child.pid === undefined) throw new Error('child did not start')
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      writePid(child.pid)
      expect(readPidState()).toMatchObject({ pid: child.pid, alive: true })

      const result = await stopService()
      expect(result).toEqual({ kind: 'stopped', pid: child.pid })
      await exited
      expect(existsSync(pidPath())).toBe(false)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('leaves an external instance alone', async () => {
    const service = await fakeService({ ok: true, service: 'clara-orchestrator', mode: 'local' })
    setEnv('CLARA_ORCHESTRATION_PORT', String(service.port))
    try {
      expect(await stopService()).toEqual({ kind: 'external' })
    } finally {
      await service.close()
    }
  })
})

describe('docker start', () => {
  it('builds the compose command with and without a rebuild', () => {
    expect(composeArgs('down')).toEqual(['compose', '-f', 'docker/compose.yml', 'down'])
    expect(composeArgs('up')).toEqual([
      'compose',
      '-f',
      'docker/compose.yml',
      'up',
      '-d',
      'orchestrator',
    ])
    expect(composeArgs('up', true)).toEqual([
      'compose',
      '-f',
      'docker/compose.yml',
      'up',
      '-d',
      '--build',
      'orchestrator',
    ])
  })

  it('starts compose when nothing is running and waits for the container', async () => {
    const builds: boolean[] = []
    let probes = 0
    const probe = async (): Promise<HealthProbe> => {
      probes += 1
      return probes === 1
        ? { status: 'unreachable' }
        : { status: 'current', mode: 'container', pid: 1 }
    }

    const result = await startDockerService({
      build: true,
      pollMs: 0,
      probe,
      composeUp: async (build) => {
        builds.push(build)
        return { ok: true, code: 0 }
      },
    })
    expect(result).toEqual({ kind: 'container-started' })
    expect(builds).toEqual([true])
  })

  it('does not run compose when a container is already running', async () => {
    let invocations = 0
    const result = await startDockerService({
      probe: async () => ({ status: 'current', mode: 'container', pid: 1 }),
      composeUp: async () => {
        invocations += 1
        return { ok: true, code: 0 }
      },
    })
    expect(result).toEqual({ kind: 'container-running' })
    expect(invocations).toBe(0)
  })

  it('refuses when a local instance is running', async () => {
    writePid(process.pid)
    const result = await startDockerService({
      probe: async () => ({ status: 'current', mode: 'local', pid: process.pid }),
      composeUp: async () => {
        throw new Error('compose must not run')
      },
    })
    expect(result).toEqual({ kind: 'local-running', pid: process.pid })
  })

  it('reports a compose failure without polling', async () => {
    let probes = 0
    const result = await startDockerService({
      probe: async () => {
        probes += 1
        return { status: 'unreachable' }
      },
      composeUp: async () => ({ ok: false, code: 3 }),
    })
    expect(result).toEqual({ kind: 'compose-failed', result: { ok: false, code: 3 } })
    expect(probes).toBe(1)
  })

  it('reports unhealthy when no container appears', async () => {
    const result = await startDockerService({
      timeoutMs: 0,
      probe: async () => ({ status: 'unreachable' }),
      composeUp: async () => ({ ok: true, code: 0 }),
    })
    expect(result).toEqual({ kind: 'unhealthy' })
  })

  it('accepts a legacy container that does not report a mode', async () => {
    let probes = 0
    const result = await startDockerService({
      pollMs: 0,
      probe: async () => {
        probes += 1
        return probes === 1
          ? { status: 'unreachable' }
          : { status: 'current', mode: 'unknown', pid: 1 }
      },
      composeUp: async () => ({ ok: true, code: 0 }),
    })
    expect(result).toEqual({ kind: 'container-started' })
  })
})
