import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PANEL_API_VERSION,
  type PanelConfigInfo,
  type PanelConfigMutationResponse,
  type PanelConfigUpdate,
  type PanelControls,
  type PanelMutationResponse,
  type PanelSnapshot,
  type ShellPolicy,
} from '@clara/shared-types'
import type { PanelControlService } from '../src/panel/controls.ts'
import { PanelAuth } from '../src/panel/auth.ts'
import { hashPassword } from '../src/panel/password.ts'
import type { PanelDataSource } from '../src/panel/runtime.ts'
import { startPanelServer, type PanelServer } from '../src/panel/server.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'
import { PanelUserStore } from '../src/store/panel-users.ts'

const tempDirs: string[] = []
const servers: PanelServer[] = []
const databases: ClaraDatabase[] = []
const cookies = new WeakMap<PanelServer, string>()

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-panel-'))
  tempDirs.push(dir)
  return dir
}

function snapshot(): PanelSnapshot {
  return {
    apiVersion: PANEL_API_VERSION,
    generatedAt: new Date(0).toISOString(),
    agent: {
      version: '0.1.0',
      protocol: 1,
      startedAt: new Date(0).toISOString(),
      uptimeMs: 1,
      pid: 1,
      node: 'v22.22.0',
      platform: 'linux',
      arch: 'x64',
      memoryRssBytes: 1,
      configPath: '/tmp/config/server.json',
      configDir: '/tmp/config',
      pskConfigured: true,
      stopped: false,
      container: false,
    },
    auth: { username: 'admin', role: 'superadmin' },
    config: {
      localHost: { value: '127.0.0.1', source: 'default' },
      localPort: { value: 8788, source: 'default' },
      relayUrl: { value: null, source: 'none' },
      relayRoom: { value: null, source: 'none' },
      pairingBaseUrl: { value: 'https://clara.example', source: 'default' },
      vapidSubject: { value: 'https://clara.local', source: 'default' },
    },
    opencode: {
      url: 'http://127.0.0.1:4096',
      passwordConfigured: false,
      reachable: true,
      desired: true,
      effective: true,
      configured: true,
      version: '2.1.1',
      latencyMs: 1,
      checkedAt: new Date(0).toISOString(),
      code: 'ok',
    },
    harness: { configured: true, activeId: 'harness-1' },
    harnesses: [
      {
        id: 'harness-1',
        kind: 'opencode',
        label: 'Test OpenCode',
        baseUrl: 'http://127.0.0.1:4096',
        authType: 'none',
        options: {},
        isActive: true,
        secretConfigured: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
    local: {
      host: '127.0.0.1',
      port: 8788,
      url: 'ws://127.0.0.1:8788/ws',
      connections: 0,
      desired: true,
      active: true,
      effective: true,
    },
    relay: {
      configured: false,
      status: 'disabled',
      desired: true,
      effective: false,
      agentTokenConfigured: false,
      clientTokenConfigured: false,
    },
    clients: [],
    push: {
      enabled: false,
      desired: false,
      effective: false,
      subscriptions: 0,
      failing: 0,
      publicKeyConfigured: false,
    },
    controls: {
      stopped: false,
      features: [
        { name: 'opencode', configured: true, desired: true, effective: true },
        { name: 'local', configured: true, desired: true, effective: true },
        { name: 'relay', configured: false, desired: true, effective: false },
        { name: 'push', configured: false, desired: false, effective: false },
      ],
      shell: { mode: 'off', commands: [], blocked: 0 },
      monitoring: { enabled: true },
      sync: { enabled: true, intervalMs: 30_000 },
      orchestration: {
        desired: false,
        effective: false,
        state: 'stopped',
        url: 'http://127.0.0.1:8789',
      },
    },
    storage: [],
    events: [],
    traffic: {
      enabled: true,
      since: new Date(0).toISOString(),
      windowMs: 3_600_000,
      warmup: false,
      totals: {
        bytesIn: 0,
        bytesOut: 0,
        framesIn: 0,
        framesOut: 0,
        requests: 0,
        sessionsOpened: 0,
        sessionsClosed: 0,
      },
      rate: {
        windowMs: 60_000,
        bytesInPerSecond: 0,
        bytesOutPerSecond: 0,
        requestsPerMinute: 0,
        errorsPerMinute: 0,
      },
      errors: {
        handshake: 0,
        crypto: 0,
        orphan: 0,
        dropped: 0,
        refused: 0,
        upstream: 0,
        expired: 0,
      },
      peak: { bytesIn: 0, bytesOut: 0, requests: 0, errors: 0 },
      series: [],
      byTransport: {
        local: { bytesIn: 0, bytesOut: 0, framesIn: 0, framesOut: 0, requests: 0 },
        relay: { bytesIn: 0, bytesOut: 0, framesIn: 0, framesOut: 0, requests: 0 },
      },
      spike: [],
    },
  }
}

function source(): PanelDataSource {
  return { snapshot: async () => snapshot() }
}

type FakeControls = PanelControlService & {
  state: PanelControls
  config: PanelConfigInfo
  features: Array<{ feature: string; enabled: boolean }>
  stops: boolean[]
  shells: ShellPolicy[]
  monitorings: boolean[]
  syncs: Array<{ enabled: boolean; intervalMs: number }>
  orchestration: boolean[]
  configs: PanelConfigUpdate[]
}

function fakeControls(initial: Partial<PanelControls> = {}): FakeControls {
  const state: PanelControls = {
    stopped: false,
    features: [
      { name: 'opencode', configured: true, desired: true, effective: true },
      { name: 'local', configured: true, desired: true, effective: true },
      { name: 'relay', configured: false, desired: false, effective: false },
      { name: 'push', configured: false, desired: false, effective: false },
    ],
    shell: { mode: 'off', commands: [], blocked: 0 },
    monitoring: { enabled: true },
    sync: { enabled: true, intervalMs: 30_000 },
    orchestration: {
      desired: false,
      effective: false,
      state: 'stopped',
      url: 'http://127.0.0.1:8789',
    },
    ...initial,
  }
  const config: PanelConfigInfo = {
    localHost: { value: '127.0.0.1', source: 'default' },
    localPort: { value: 8788, source: 'default' },
    relayUrl: { value: null, source: 'none' },
    relayRoom: { value: null, source: 'none' },
    pairingBaseUrl: { value: 'https://clara.example', source: 'default' },
    vapidSubject: { value: 'https://clara.local', source: 'default' },
  }
  const features: Array<{ feature: string; enabled: boolean }> = []
  const stops: boolean[] = []
  const shells: ShellPolicy[] = []
  const monitorings: boolean[] = []
  const syncs: Array<{ enabled: boolean; intervalMs: number }> = []
  const orchestration: boolean[] = []
  const configs: PanelConfigUpdate[] = []
  return {
    state,
    config,
    features,
    stops,
    shells,
    monitorings,
    syncs,
    orchestration,
    configs,
    controls: () => state,
    setFeature: async (feature, enabled) => {
      if (state.stopped) {
        throw Object.assign(new Error('The agent is stopped.'), {
          status: 409,
          code: 'agent_stopped',
        })
      }
      features.push({ feature, enabled })
      state.features = state.features.map((entry) =>
        entry.name === feature ? { ...entry, desired: enabled, effective: enabled } : entry
      )
      return state
    },
    setStopped: async (stopped) => {
      stops.push(stopped)
      state.stopped = stopped
      return state
    },
    setShellPolicy: async (policy) => {
      shells.push(policy)
      state.shell = { ...policy, blocked: state.shell.blocked }
      return state
    },
    setMonitoring: async (enabled) => {
      monitorings.push(enabled)
      state.monitoring = { enabled }
      return state
    },
    setSync: async (update) => {
      syncs.push(update)
      state.sync = { ...update }
      return state
    },
    setOrchestration: async (enabled) => {
      orchestration.push(enabled)
      state.orchestration = { ...state.orchestration, desired: enabled, effective: enabled }
      return state
    },
    updateConfig: async (update) => {
      configs.push(update)
      if ('pairingBaseUrl' in update) {
        const value = update.pairingBaseUrl
        config.pairingBaseUrl = {
          value: value ?? 'http://127.0.0.1:8080',
          source: value ? 'file' : 'default',
        }
      }
      if ('vapidSubject' in update) {
        const value = update.vapidSubject
        config.vapidSubject = {
          value: value ?? 'https://clara.local',
          source: value ? 'file' : 'default',
        }
      }
      return config
    },
    saveHarness: async () => ({ harnesses: [], harness: { configured: false } }),
    testHarness: async () => ({
      ok: true,
      code: 'ok',
      latencyMs: 1,
      checkedAt: new Date(0).toISOString(),
    }),
    activateHarness: async () => ({ harnesses: [], harness: { configured: false } }),
    deleteHarness: async () => ({ harnesses: [], harness: { configured: false } }),
  }
}

async function start(assetsDir?: string, controls?: PanelControlService): Promise<PanelServer> {
  const dir = tempDir()
  const db = openDatabase(join(dir, 'clara.db'))
  const users = new PanelUserStore(db)
  users.create('admin', await hashPassword('test-password'))
  const auth = new PanelAuth({ users, configDir: dir })
  const login = await auth.login('admin', 'test-password', 'test')
  const server = await startPanelServer({
    source: source(),
    controls,
    auth,
    port: 0,
    assetsDir,
  })
  servers.push(server)
  databases.push(db)
  cookies.set(server, `clara_panel_session=${login.token}`)
  return server
}

function get(server: PanelServer, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: cookies.get(server) ?? '',
    },
  })
}

function fetchPanel(server: PanelServer, path: string, init: RequestInit = {}): Promise<Response> {
  return get(server, path, init)
}

function post(
  server: PanelServer,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${server.url}panel/api/v1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-clara-panel': '1',
      ...headers,
      ...(cookies.get(server) ? { cookie: cookies.get(server) as string } : {}),
    },
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('panel server', () => {
  it('keeps health open and requires a session for the status API', async () => {
    const server = await start()

    const health = await fetch(`${server.url}health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, service: 'clara-server' })

    const anonymous = await fetch(`${server.url}panel/api/v1/status`)
    expect(anonymous.status).toBe(401)

    const session = await fetch(`${server.url}panel/api/v1/session`)
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ authenticated: false, setupRequired: false })

    const login = await fetch(`${server.url}panel/api/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clara-panel': '1',
      },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    })
    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('clara_panel_session=')
  })

  it('routes harness mutations through the panel control service', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const saved = await post(server, 'harnesses', {
      kind: 'opencode',
      label: 'OpenCode',
      baseUrl: 'http://opencode:4096',
      authType: 'none',
    })
    expect(saved.status).toBe(200)

    const tested = await post(server, 'harnesses/harness-1/test', {
      kind: 'opencode',
      label: 'OpenCode',
      baseUrl: 'http://opencode:4096',
      authType: 'none',
    })
    expect(tested.status).toBe(200)
  })

  it('serves the read-only status snapshot', async () => {
    const server = await start()
    const response = await get(server, 'panel/api/v1/status')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const body = (await response.json()) as PanelSnapshot
    expect(body.apiVersion).toBe(PANEL_API_VERSION)
    expect(body.agent.version).toBe('0.1.0')
  })

  it('allows HEAD and rejects every mutating method', async () => {
    const server = await start()
    const head = await get(server, 'panel/api/v1/status', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const post = await get(server, 'panel/api/v1/status', { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  it('rejects a forged Host, origin, or cross-site fetch metadata', async () => {
    const server = await start()

    const forgedHost = await rawRequest(server.port, '/panel/api/v1/status', {
      host: 'evil.example:8790',
    })
    expect(forgedHost.status).toBe(403)

    const forgedOrigin = await rawRequest(server.port, '/panel/api/v1/status', {
      origin: 'https://evil.example',
    })
    expect(forgedOrigin.status).toBe(403)

    const crossSite = await rawRequest(server.port, '/panel/api/v1/status', {
      'sec-fetch-site': 'cross-site',
    })
    expect(crossSite.status).toBe(403)
  })

  it('serves the built panel with strict headers and hashed assets', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Clara agent</title>')
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("panel")')
    writeFileSync(join(dir, 'favicon.svg'), '<svg></svg>')
    const server = await start(dir)

    const page = await fetch(server.url)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(await page.text()).toContain('Clara agent')

    const asset = await fetch(`${server.url}assets/app-abc123.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')

    const icon = await fetch(`${server.url}favicon.svg`)
    expect(icon.status).toBe(200)
  })

  it('does not serve files outside the asset directory', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html>')
    writeFileSync(join(dir, 'secret.ts'), 'do not serve')
    const server = await start(dir)

    const traversal = await rawRequest(server.port, '/assets/%2e%2e/secret.ts')
    expect(traversal.status).toBe(404)
    const unknown = await rawRequest(server.port, '/secret.ts')
    expect(unknown.status).toBe(404)
  })

  it('explains how to build the panel when assets are missing', async () => {
    const server = await start()
    const response = await fetch(server.url)
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('pnpm build')
  })

  it('returns JSON for unknown API paths', async () => {
    const server = await start()
    const response = await get(server, 'panel/api/v1/unknown')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('rejects mutations without the panel header', async () => {
    const server = await start(undefined, fakeControls())
    const response = await fetchPanel(server, 'panel/api/v1/features', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feature: 'relay', enabled: false }),
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('missing_panel_header')
  })

  it('rejects mutations with the wrong content type', async () => {
    const server = await start(undefined, fakeControls())
    const response = await post(
      server,
      'features',
      { feature: 'relay', enabled: false },
      { 'content-type': 'text/plain' }
    )
    expect(response.status).toBe(415)
  })

  it('rejects an oversized mutation body', async () => {
    const server = await start(undefined, fakeControls())
    const response = await post(server, 'features', {
      feature: 'relay',
      enabled: false,
      padding: 'x'.repeat(9_000),
    })
    expect(response.status).toBe(413)
  })

  it('rejects unknown features and fields', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const unknownFeature = await post(server, 'features', { feature: 'admin', enabled: true })
    expect(unknownFeature.status).toBe(400)

    const unknownField = await post(server, 'features', {
      feature: 'relay',
      enabled: false,
      extra: true,
    })
    expect(unknownField.status).toBe(400)

    const wrongType = await post(server, 'agent', { stopped: 'yes' })
    expect(wrongType.status).toBe(400)
    expect(controls.features).toEqual([])
  })

  it('rejects feature changes while the agent is stopped', async () => {
    const controls = fakeControls({ stopped: true })
    const server = await start(undefined, controls)
    const response = await post(server, 'features', { feature: 'relay', enabled: true })
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('agent_stopped')
    expect(controls.features).toEqual([])
  })

  it('applies a feature change and returns the updated controls', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)
    const response = await post(server, 'features', { feature: 'relay', enabled: false })
    expect(response.status).toBe(200)
    const body = (await response.json()) as PanelMutationResponse
    expect(controls.features).toEqual([{ feature: 'relay', enabled: false }])
    expect(body.controls.features.find((entry) => entry.name === 'relay')).toMatchObject({
      desired: false,
      effective: false,
    })
  })

  it('stops and starts the agent through the mutation route', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const stopped = await post(server, 'agent', { stopped: true })
    expect(stopped.status).toBe(200)
    expect(((await stopped.json()) as PanelMutationResponse).controls.stopped).toBe(true)

    const started = await post(server, 'agent', { stopped: false })
    expect(started.status).toBe(200)
    expect(controls.stops).toEqual([true, false])
  })

  it('applies a shell policy and rejects bad command entries', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const applied = await post(server, 'shell', {
      mode: 'allowlist',
      commands: ['  git   log ', 'git log'],
    })
    expect(applied.status).toBe(200)
    expect(controls.shells).toEqual([{ mode: 'allowlist', commands: ['git log'] }])
    const body = (await applied.json()) as PanelMutationResponse
    expect(body.controls.shell).toMatchObject({
      mode: 'allowlist',
      commands: ['git log'],
      blocked: 0,
    })

    const interpreter = await post(server, 'shell', { mode: 'allowlist', commands: ['bash'] })
    expect(interpreter.status).toBe(400)

    const syntax = await post(server, 'shell', {
      mode: 'allowlist',
      commands: ['git log; rm -rf /'],
    })
    expect(syntax.status).toBe(400)

    const unknown = await post(server, 'shell', {
      mode: 'allowlist',
      commands: [],
      extra: true,
    })
    expect(unknown.status).toBe(400)

    const badMode = await post(server, 'shell', { mode: 'ask', commands: [] })
    expect(badMode.status).toBe(400)
    expect(controls.shells).toHaveLength(1)
  })

  it('toggles traffic monitoring even while the agent is stopped', async () => {
    const controls = fakeControls({ stopped: true })
    const server = await start(undefined, controls)

    const off = await post(server, 'monitoring', { enabled: false })
    expect(off.status).toBe(200)
    expect(((await off.json()) as PanelMutationResponse).controls.monitoring).toEqual({
      enabled: false,
    })

    const on = await post(server, 'monitoring', { enabled: true })
    expect(on.status).toBe(200)
    expect(controls.monitorings).toEqual([false, true])
  })

  it('updates the global sync gate and interval even while the agent is stopped', async () => {
    const controls = fakeControls({ stopped: true })
    const server = await start(undefined, controls)

    const response = await post(server, 'sync', { enabled: false, intervalMs: 5_000 })
    expect(response.status).toBe(200)
    expect(((await response.json()) as PanelMutationResponse).controls.sync).toEqual({
      enabled: false,
      intervalMs: 5_000,
    })
    expect(controls.syncs).toEqual([{ enabled: false, intervalMs: 5_000 }])
  })

  it('rejects invalid sync settings', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    expect((await post(server, 'sync', { enabled: false, intervalMs: 1_000 })).status).toBe(400)
    expect((await post(server, 'sync', { enabled: false, intervalMs: 16 * 60_000 })).status).toBe(
      400
    )
    expect((await post(server, 'sync', { enabled: 'no', intervalMs: 5_000 })).status).toBe(400)
    expect(
      (await post(server, 'sync', { enabled: false, intervalMs: 5_000, extra: true })).status
    ).toBe(400)
    expect(controls.syncs).toEqual([])
  })

  it('rejects a monitoring body with an unknown or mistyped field', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const unknown = await post(server, 'monitoring', { enabled: true, extra: true })
    expect(unknown.status).toBe(400)

    const wrongType = await post(server, 'monitoring', { enabled: 'yes' })
    expect(wrongType.status).toBe(400)
    expect(controls.monitorings).toEqual([])
  })

  it('toggles orchestration and rejects malformed requests', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const response = await post(server, 'orchestration', { enabled: true })
    expect(response.status).toBe(200)
    expect(((await response.json()) as PanelMutationResponse).controls.orchestration).toMatchObject(
      { desired: true, effective: true }
    )
    expect(controls.orchestration).toEqual([true])

    expect((await post(server, 'orchestration', { enabled: 'yes' })).status).toBe(400)
    expect((await post(server, 'orchestration', { enabled: true, extra: true })).status).toBe(400)
    expect(controls.orchestration).toEqual([true])
  })

  it('updates the file-backed config values', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const web = await post(server, 'config', { pairingBaseUrl: 'https://clara.example' })
    expect(web.status).toBe(200)
    expect(((await web.json()) as PanelConfigMutationResponse).config.pairingBaseUrl).toEqual({
      value: 'https://clara.example',
      source: 'file',
    })

    const vapid = await post(server, 'config', { vapidSubject: 'mailto:ops@example.com' })
    expect(vapid.status).toBe(200)
    expect(((await vapid.json()) as PanelConfigMutationResponse).config.vapidSubject).toEqual({
      value: 'mailto:ops@example.com',
      source: 'file',
    })
    expect(controls.configs).toEqual([
      { pairingBaseUrl: 'https://clara.example' },
      { vapidSubject: 'mailto:ops@example.com' },
    ])
  })

  it('clears file-backed config values with null', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    const response = await post(server, 'config', { pairingBaseUrl: null, vapidSubject: null })
    expect(response.status).toBe(200)
    const body = (await response.json()) as PanelConfigMutationResponse
    expect(body.config.pairingBaseUrl).toEqual({
      value: 'http://127.0.0.1:8080',
      source: 'default',
    })
    expect(body.config.vapidSubject).toEqual({
      value: 'https://clara.local',
      source: 'default',
    })
  })

  it('rejects malformed config mutations', async () => {
    const controls = fakeControls()
    const server = await start(undefined, controls)

    expect((await post(server, 'config', {})).status).toBe(400)
    expect((await post(server, 'config', { pairingBaseUrl: 1 })).status).toBe(400)
    expect((await post(server, 'config', { vapidSubject: 1 })).status).toBe(400)
    expect((await post(server, 'config', { extra: true })).status).toBe(400)
    expect(controls.configs).toEqual([])
  })

  it('maps an environment override to a conflict', async () => {
    const controls = fakeControls()
    controls.updateConfig = async () => {
      throw Object.assign(new Error('locked'), { status: 409, code: 'env_override' })
    }
    const server = await start(undefined, controls)

    const response = await post(server, 'config', { pairingBaseUrl: 'https://clara.example' })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('env_override')
  })
})

function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolvePromise({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      }
    )
    request.on('error', reject)
    request.end()
  })
}
