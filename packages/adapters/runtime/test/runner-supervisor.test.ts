import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  RunnerSupervisor,
  listRunnerChildren,
  readRunnerDesired,
  runnerDesiredPath,
  runnerWorkspaceHash,
  stopRunnerChildren,
  writeRunnerDesired,
} from '../src/runner-supervisor.ts'
import type { AdapterPaths } from '../src/types.ts'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-runner-supervisor-'))
  roots.push(root)
  return root
}

function adapterPaths(root: string): AdapterPaths {
  return {
    name: 'opencode',
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
    configPath: join(root, 'config', 'config.json'),
    identityPath: join(root, 'config', 'identity.json'),
    logPath: join(root, 'data', 'adapter.log'),
    pidPath: join(root, 'data', 'adapter.pid'),
    statePath: join(root, 'data', 'status.json'),
  }
}

type Row = {
  id: string
  harness: string
  role: 'harness' | 'runner'
  machine: string
  workspace: string
  heartbeat_at: string
  capabilities: string
  labels: string
}

async function startRegistry(rows: () => Row[]): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && (request.url ?? '').startsWith('/v1/adapters')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(rows()))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('registry did not bind')
  return { url: `http://127.0.0.1:${address.port}`, server }
}

function harnessRow(workspace: string, options: Partial<Row> = {}): Row {
  return {
    id: `adapter-${workspace}`,
    harness: 'opencode',
    role: 'harness',
    machine: hostname(),
    workspace,
    heartbeat_at: new Date().toISOString(),
    capabilities: '["agent"]',
    labels: '[]',
    ...options,
  }
}

function supervisorFor(
  root: string,
  url: string,
  spawned: { args: string[][]; procs: ChildProcess[] }
): RunnerSupervisor {
  const paths = adapterPaths(root)
  return new RunnerSupervisor({
    name: 'opencode',
    paths,
    env: { ...process.env, CLARA_DATA_DIR: join(root, 'data'), CLARA_ENGINE_URL: url, CLARA_ENGINE_TOKEN: 't' },
    log: () => {},
    spawnChild: (args) => {
      spawned.args.push(args)
      const proc = spawn('sleep', ['30'], { stdio: 'ignore' })
      spawned.procs.push(proc)
      return proc
    },
  })
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('runner desired state', () => {
  it('round-trips workspaces and ignores a malformed file', () => {
    const root = tempRoot()
    const paths = adapterPaths(root)
    expect(readRunnerDesired(paths)).toEqual([])
    writeRunnerDesired(paths, [{ path: '/work/one', concurrency: 3, labels: ['gpu'] }])
    expect(readRunnerDesired(paths)).toEqual([
      { path: '/work/one', concurrency: 3, labels: ['gpu'] },
    ])
    expect(JSON.parse(readFileSync(runnerDesiredPath(paths), 'utf8')).workspaces).toHaveLength(1)
    writeFileSync(runnerDesiredPath(paths), 'not json')
    expect(readRunnerDesired(paths)).toEqual([])
  })
})

describe('runner supervisor', () => {
  it('runs exactly one child per desired workspace and stops removed ones', async () => {
    const root = tempRoot()
    const paths = adapterPaths(root)
    const { url, server } = await startRegistry(() => [])
    const spawned: { args: string[][]; procs: ChildProcess[] } = { args: [], procs: [] }
    try {
      const supervisor = supervisorFor(root, url, spawned)
      writeRunnerDesired(paths, [{ path: '/work/one' }])
      await supervisor.reconcile()
      await supervisor.reconcile()
      expect(spawned.args).toHaveLength(1)
      expect(spawned.args[0]).toContain('--workspace')
      const children = listRunnerChildren(paths)
      expect(children).toHaveLength(1)
      expect(children[0].workspace).toBe('/work/one')

      writeRunnerDesired(paths, [{ path: '/work/one' }, { path: '/work/two' }])
      await supervisor.reconcile()
      expect(spawned.args).toHaveLength(2)
      expect(listRunnerChildren(paths)).toHaveLength(2)

      writeRunnerDesired(paths, [{ path: '/work/two' }])
      await supervisor.reconcile()
      const remaining = listRunnerChildren(paths)
      expect(remaining.map((child) => child.workspace)).toEqual(['/work/two'])
      await supervisor.stop()
      expect(listRunnerChildren(paths)).toHaveLength(0)
    } finally {
      for (const proc of spawned.procs) proc.kill()
      server.close()
    }
  })

  it('derives workspaces from live harness rows for this machine only', async () => {
    const root = tempRoot()
    const paths = adapterPaths(root)
    const rows = [
      harnessRow('/work/hosted'),
      harnessRow('/work/other-machine', { machine: 'somewhere-else' }),
      harnessRow('/work/stale', { heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString() }),
      harnessRow('/work/runner-row', { role: 'runner' }),
    ]
    const { url, server } = await startRegistry(() => rows)
    const spawned: { args: string[][]; procs: ChildProcess[] } = { args: [], procs: [] }
    try {
      const supervisor = supervisorFor(root, url, spawned)
      await supervisor.reconcile()
      expect(spawned.args).toHaveLength(1)
      expect(spawned.args[0]).toContain('/work/hosted')
      expect(listRunnerChildren(paths).map((child) => child.workspace)).toEqual(['/work/hosted'])
      await supervisor.stop()
    } finally {
      for (const proc of spawned.procs) proc.kill()
      server.close()
    }
  })

  it('lets one adapter daemon own the runner for a workspace', async () => {
    const root = tempRoot()
    const paths = adapterPaths(root)
    const { url, server } = await startRegistry(() => [])
    const firstSpawned: { args: string[][]; procs: ChildProcess[] } = { args: [], procs: [] }
    const secondSpawned: { args: string[][]; procs: ChildProcess[] } = { args: [], procs: [] }
    try {
      writeRunnerDesired(paths, [{ path: '/work/shared' }])
      const first = supervisorFor(root, url, firstSpawned)
      const second = supervisorFor(root, url, secondSpawned)
      await first.reconcile()
      await second.reconcile()
      expect(firstSpawned.args).toHaveLength(1)
      expect(secondSpawned.args).toHaveLength(0)
      await first.stop()
      await second.reconcile()
      expect(secondSpawned.args).toHaveLength(1)
      await second.stop()
    } finally {
      for (const proc of [...firstSpawned.procs, ...secondSpawned.procs]) proc.kill()
      server.close()
    }
  })

  it('stopRunnerChildren ends the child and clears its record', async () => {
    const root = tempRoot()
    const paths = adapterPaths(root)
    const { url, server } = await startRegistry(() => [])
    const spawned: { args: string[][]; procs: ChildProcess[] } = { args: [], procs: [] }
    try {
      const supervisor = supervisorFor(root, url, spawned)
      writeRunnerDesired(paths, [{ path: '/work/stop' }])
      await supervisor.reconcile()
      const [child] = listRunnerChildren(paths)
      expect(child).toBeDefined()
      expect(existsSync(join(paths.dataDir, `runner-${runnerWorkspaceHash('/work/stop')}.pid`)))
      const stopped = await stopRunnerChildren(paths, { workspace: '/work/stop' })
      expect(stopped).toEqual([child.pid])
      expect(listRunnerChildren(paths)).toHaveLength(0)
      await supervisor.stop()
    } finally {
      for (const proc of spawned.procs) proc.kill()
      server.close()
    }
  })
})
