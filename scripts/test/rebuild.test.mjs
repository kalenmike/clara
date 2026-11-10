import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { adapterSnapshot } from '../lib/rebuild/run.mjs'
import {
  deploymentModes,
  evaluateHealth,
  parseWorktreeList,
  primaryWorktree,
  recoveryPlan,
  restartPlan,
} from '../lib/rebuild/plan.mjs'
import {
  canSignal,
  parseFuserPid,
  parseLsofPids,
  parseSsListeners,
  positiveInt,
  probeControl,
  probeWeb,
} from '../lib/rebuild/probe.mjs'
import { isSnapshotStale, readState, tail, writeState } from '../lib/rebuild/state.mjs'

const adapter = {
  opencode: {
    linked: true,
    agentInstalled: true,
    target: '/work/clara/plugins/clara-policy',
  },
  mcp: { configured: true, configPath: '/home/user/.config/opencode/opencode.json' },
}

function state(overrides = {}) {
  return {
    schema: 1,
    createdAt: '2026-11-09T00:00:00.000Z',
    root: '/work/clara',
    orchestrator: {
      expected: true,
      healthy: true,
      state: 'local',
      mode: 'local',
      url: 'http://127.0.0.1:8789',
      workspace: '/work/clara',
    },
    lab: {
      expected: true,
      healthy: true,
      state: 'running',
      url: 'http://127.0.0.1:8791',
      port: 8791,
      workspace: '/work/clara',
      orchestrator: 'http://127.0.0.1:8789',
      connected: true,
    },
    control: {
      expected: true,
      healthy: true,
      state: 'running',
      panelPort: 8790,
      localPort: 8788,
      panel: { healthy: true, pid: 120 },
      local: { healthy: true },
    },
    web: {
      expected: true,
      healthy: true,
      state: 'running',
      mode: 'container',
      url: 'http://127.0.0.1:8080',
      port: 8080,
    },
    adapters: adapter,
    ...overrides,
  }
}

function observed(overrides = {}) {
  return {
    orchestrator: {
      expected: true,
      healthy: true,
      state: 'local',
      mode: 'local',
      url: 'http://127.0.0.1:8789',
      workspace: '/work/clara',
    },
    lab: {
      expected: true,
      healthy: true,
      state: 'running',
      url: 'http://127.0.0.1:8791',
      port: 8791,
      workspace: '/work/clara',
      connected: true,
    },
    control: {
      expected: true,
      healthy: true,
      state: 'running',
      panel: { healthy: true },
      local: { healthy: true },
    },
    web: {
      expected: true,
      healthy: true,
      state: 'running',
      mode: 'container',
      url: 'http://127.0.0.1:8080',
      port: 8080,
    },
    ...overrides,
  }
}

test('parses worktree porcelain and picks the primary checkout', () => {
  const worktrees = parseWorktreeList(`worktree /work/clara
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/clara-worktrees/rebuild-pipeline
HEAD 2222222222222222222222222222222222222222
branch refs/heads/task/rebuild-pipeline
`)
  assert.deepEqual(worktrees, [
    { path: '/work/clara', branch: 'main' },
    { path: '/work/clara-worktrees/rebuild-pipeline', branch: 'task/rebuild-pipeline' },
  ])
  assert.equal(primaryWorktree(worktrees), '/work/clara')
})

test('restart plan restores only captured services, in order', () => {
  const plan = restartPlan(state(), { skip: [], manageExternal: false })
  assert.deepEqual(
    plan.services.map((service) => [service.name, service.action]),
    [
      ['web', 'restart'],
      ['lab', 'restart'],
      ['control', 'restart'],
      ['orchestrator', 'restart'],
    ]
  )
})

test('restart plan leaves stopped services alone', () => {
  const plan = restartPlan(
    state({
      web: { expected: false, healthy: false, state: 'stopped' },
      lab: { expected: false, healthy: false, state: 'stopped' },
      control: { expected: false, healthy: false, state: 'stopped' },
      orchestrator: { expected: false, healthy: false, state: 'unreachable' },
    })
  )
  assert.deepEqual(
    plan.services.map((service) => [service.name, service.action]),
    [
      ['web', 'skip'],
      ['lab', 'skip'],
      ['control', 'skip'],
      ['orchestrator', 'skip'],
    ]
  )
})

test('deployment modes save local, container, external, and stopped forms', () => {
  const local = deploymentModes({
    orchestrator: { expected: true, mode: 'local' },
    lab: { expected: true },
    control: { expected: true, mode: 'local' },
    web: { expected: true },
  })
  assert.deepEqual(local, {
    orchestrator: { mode: 'local', container: false, external: false },
    control: { mode: 'local', container: false },
    lab: { mode: 'host' },
    web: { mode: 'local', container: false },
  })

  const container = deploymentModes({
    orchestrator: { expected: true, mode: 'container' },
    lab: { expected: false },
    control: { expected: true, panel: { container: true } },
    web: { expected: true, mode: 'container' },
  })
  assert.equal(container.orchestrator.mode, 'container')
  assert.equal(container.control.mode, 'container')
  assert.equal(container.control.container, true)
  assert.equal(container.lab.mode, 'stopped')
  assert.equal(container.web.mode, 'container')

  const compose = deploymentModes({
    orchestrator: { expected: false },
    lab: { expected: false },
    control: { expected: true, local: { healthy: true } },
    web: { expected: false },
    compose: { control: true, web: true },
  })
  assert.equal(compose.control.mode, 'container')
  assert.equal(compose.web.mode, 'container')

  const external = deploymentModes({
    orchestrator: { expected: true, mode: 'container', external: true },
    lab: { expected: false },
    control: { expected: false },
  })
  assert.equal(external.orchestrator.mode, 'container')
  assert.equal(external.orchestrator.external, true)
  assert.equal(external.control.mode, 'stopped')
  assert.equal(external.web.mode, 'stopped')
})

test('probe control reads container mode from the panel health endpoint', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ ok: true, service: 'clara-server', version: 'test', mode: 'container' })
      )
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const probe = await probeControl({ panelPort: port, localPort: port + 1, timeoutMs: 500 })
    assert.equal(probe.expected, true)
    assert.equal(probe.mode, 'container')
    assert.equal(probe.panel?.container, true)
    assert.equal(probe.pid, null)
    assert.equal(probe.systemd, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('restart plan skips a web client served outside the container', () => {
  const plan = restartPlan(
    state({
      web: {
        expected: true,
        healthy: true,
        state: 'running',
        mode: 'local',
        url: 'http://127.0.0.1:8080',
        port: 8080,
      },
    })
  )
  const web = plan.services.find((service) => service.name === 'web')
  assert.equal(web?.action, 'skip')
  assert.equal(web?.mode, 'local')
  assert.ok(plan.warnings.some((warning) => warning.includes('not a container')))
})

test('probe web reads the healthz contract', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, service: 'clara-web' }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    const probe = await probeWeb({ port, timeoutMs: 500, container: true })
    assert.equal(probe.expected, true)
    assert.equal(probe.healthy, true)
    assert.equal(probe.mode, 'container')
    assert.equal(probe.url, `http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('health warns when the web client changes deployment mode', () => {
  const report = evaluateHealth(
    state(),
    observed({
      web: {
        expected: true,
        healthy: true,
        state: 'running',
        mode: 'local',
        url: 'http://127.0.0.1:8080',
        port: 8080,
      },
    }),
    { adapter }
  )
  assert.equal(report.ok, true)
  assert.ok(
    report.warnings.some((warning) => warning.includes('mode changed from container to local'))
  )
})

test('restart plan records the captured deployment mode', () => {
  const plan = restartPlan(
    state({
      control: {
        expected: true,
        healthy: true,
        state: 'running',
        mode: 'container',
        panel: { healthy: true, container: true },
        local: { healthy: true },
      },
    })
  )
  assert.equal(plan.services.find((service) => service.name === 'control')?.mode, 'container')
  assert.equal(plan.services.find((service) => service.name === 'lab')?.mode, 'host')
})

test('health warns when the home agent changes deployment mode', () => {
  const report = evaluateHealth(
    state({
      control: {
        expected: true,
        healthy: true,
        state: 'running',
        mode: 'container',
        panel: { healthy: true, container: true },
        local: { healthy: true },
      },
    }),
    observed({
      control: {
        expected: true,
        healthy: true,
        state: 'running',
        mode: 'local',
        panel: { healthy: true },
        local: { healthy: true },
      },
    }),
    { adapter }
  )
  assert.equal(report.ok, true)
  assert.ok(
    report.warnings.some((warning) => warning.includes('mode changed from container to local'))
  )
})

test('recovery plan restarts only expected unhealthy services', () => {
  const health = {
    services: [
      { name: 'web', expected: true, healthy: true },
      { name: 'lab', expected: true, healthy: false },
      { name: 'control', expected: true, healthy: true },
      { name: 'orchestrator', expected: true, healthy: true },
    ],
  }
  const plan = recoveryPlan(state(), health)
  assert.deepEqual(plan.only, ['lab'])
  assert.deepEqual(
    plan.services.map((service) => [service.name, service.action]),
    [
      ['web', 'skip'],
      ['lab', 'restart'],
      ['control', 'skip'],
      ['orchestrator', 'skip'],
    ]
  )
})

test('recovery plan ignores services stopped when captured', () => {
  const health = {
    services: [{ name: 'orchestrator', expected: false, healthy: false }],
  }
  const plan = recoveryPlan(
    state({ orchestrator: { expected: false, healthy: false, state: 'stopped' } }),
    health
  )
  assert.deepEqual(plan.only, [])
  assert.ok(plan.services.every((service) => service.action === 'skip'))
})

test('restart plan honours an explicit only list', () => {
  const plan = restartPlan(state(), { only: ['control'] })
  assert.deepEqual(
    plan.services.map((service) => [service.name, service.action]),
    [
      ['web', 'skip'],
      ['lab', 'skip'],
      ['control', 'restart'],
      ['orchestrator', 'skip'],
    ]
  )
})

test('restart plan skips an external orchestrator unless forced', () => {
  const external = {
    expected: true,
    healthy: true,
    state: 'container',
    mode: 'container',
    url: 'http://orchestrator:8789',
    external: true,
  }
  const skipped = restartPlan(state({ orchestrator: external }))
  assert.equal(skipped.services[3].action, 'skip')
  assert.ok(skipped.warnings[0].includes('external'))

  const forced = restartPlan(state({ orchestrator: external }), { manageExternal: true })
  assert.equal(forced.services[3].action, 'restart')
})

test('restart plan honors --skip', () => {
  const plan = restartPlan(state(), { skip: ['lab'] })
  assert.equal(plan.services[1].action, 'skip')
  assert.equal(plan.services[2].action, 'restart')
})

test('health passes when every captured service and adapter is present', () => {
  const report = evaluateHealth(state(), observed(), {
    adapter,
    now: new Date('2026-11-09T01:00:00.000Z'),
  })
  assert.equal(report.ok, true)
  assert.equal(report.checkedAt, '2026-11-09T01:00:00.000Z')
  assert.deepEqual(report.warnings, [])
})

test('health fails when a captured service is down', () => {
  const report = evaluateHealth(
    state(),
    observed({ lab: { expected: false, healthy: false, state: 'stopped' } }),
    { adapter }
  )
  assert.equal(report.ok, false)
  assert.equal(report.services.find((service) => service.name === 'lab')?.healthy, false)
})

test('health ignores services that were stopped at capture', () => {
  const report = evaluateHealth(
    state({
      lab: { expected: false, healthy: false, state: 'stopped' },
    }),
    observed({ lab: { expected: false, healthy: false, state: 'stopped' } }),
    { adapter }
  )
  assert.equal(report.ok, true)
  assert.equal(report.services.find((service) => service.name === 'lab')?.expected, false)
})

test('health reports a lost lab connection without failing the lab itself', () => {
  const report = evaluateHealth(
    state(),
    observed({
      lab: {
        expected: true,
        healthy: true,
        state: 'running',
        url: 'http://127.0.0.1:8791',
        port: 8791,
        workspace: '/work/clara',
        connected: false,
      },
    }),
    { adapter }
  )
  assert.equal(report.ok, true)
  assert.ok(report.warnings.some((warning) => warning.includes('lost its orchestrator')))
})

test('health fails when the adapter is missing or the MCP entry was expected', () => {
  const missingAdapter = evaluateHealth(state(), observed(), {
    adapter: { opencode: { linked: false, agentInstalled: false }, mcp: { configured: false } },
  })
  assert.equal(missingAdapter.ok, false)

  const missingMcp = evaluateHealth(state(), observed(), {
    adapter: { ...adapter, mcp: { configured: false } },
  })
  assert.equal(missingMcp.ok, false)
})

test('health warns about an external orchestrator and a mode change', () => {
  const report = evaluateHealth(
    state({
      orchestrator: {
        expected: true,
        healthy: true,
        state: 'container',
        mode: 'container',
        url: 'http://orchestrator:8789',
        external: true,
      },
    }),
    observed({
      orchestrator: {
        expected: true,
        healthy: true,
        state: 'local',
        mode: 'local',
        url: 'http://127.0.0.1:8789',
      },
    }),
    { adapter }
  )
  assert.equal(report.ok, true)
  assert.ok(report.warnings.some((warning) => warning.includes('managed outside')))
  assert.ok(report.warnings.some((warning) => warning.includes('mode changed')))
})

test('parses listener pids from ss and lsof output', () => {
  const ss = `State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0 511 127.0.0.1:8793 0.0.0.0:* users:(("node",pid=341139,fd=24))
LISTEN 0 511 127.0.0.1:8791 0.0.0.0:*
`
  assert.equal(parseSsListeners(ss, 8793), 341139)
  assert.equal(parseSsListeners(ss, 8791), undefined)
  assert.equal(parseLsofPids('123\n456\n'), 123)
  assert.equal(parseFuserPid(' 8793/tcp: 341139'), 341139)
})

test('validates positive ports', () => {
  assert.equal(positiveInt('8791', 8789), 8791)
  assert.equal(positiveInt('0', 8789), 8789)
  assert.equal(positiveInt('nope', 8789), 8789)
})

test('only signals a live process owned by this user', () => {
  assert.equal(canSignal(process.pid), true)
  assert.equal(canSignal(1), false)
  assert.equal(canSignal(0), false)
})

test('round-trips the snapshot and rejects the wrong schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-rebuild-'))
  try {
    const path = join(dir, 'setup.json')
    writeState(state(), path)
    assert.equal(readState(path)?.root, '/work/clara')

    writeFileSync(path, JSON.stringify({ schema: 2 }))
    assert.equal(readState(path), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detects stale snapshots and trims long output', () => {
  assert.equal(isSnapshotStale({ createdAt: new Date().toISOString() }, Date.now()), false)
  assert.equal(
    isSnapshotStale(
      { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      Date.now()
    ),
    true
  )
  assert.equal(tail('abcdef', 3), '…def')
  assert.equal(tail('abc', 3), 'abc')
})

test('reads the installed adapter and MCP entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-'))
  try {
    const config = join(dir, 'opencode')
    const plugin = join(dir, 'plugins', 'clara-policy')
    mkdirSync(join(config, 'plugins'), { recursive: true })
    mkdirSync(join(config, 'agents'), { recursive: true })
    mkdirSync(plugin, { recursive: true })
    symlinkSync(plugin, join(config, 'plugins', 'clara-policy'), 'dir')
    writeFileSync(join(config, 'agents', 'clara.md'), '# Clara\n')
    writeFileSync(
      join(config, 'opencode.json'),
      JSON.stringify({ mcp: { clara: { type: 'local' } } })
    )

    const snapshot = adapterSnapshot('/work/clara', { XDG_CONFIG_HOME: dir })
    assert.equal(snapshot.opencode.linked, true)
    assert.equal(snapshot.opencode.agentInstalled, true)
    assert.equal(snapshot.opencode.target, plugin)
    assert.equal(snapshot.mcp.configured, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
