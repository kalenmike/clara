import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PANEL_API_VERSION, type PanelControls, type PanelSnapshot } from '@clara/shared-types'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies, PanelEndpoint } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
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

type PanelFixture = {
  server: PanelServer
  token: string
  endpoint: PanelEndpoint
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-panel-bridge-'))
  tempDirs.push(dir)
  return dir
}

function snapshot(): PanelSnapshot {
  return {
    apiVersion: PANEL_API_VERSION,
    generatedAt: new Date(0).toISOString(),
  } as PanelSnapshot
}

function source(): PanelDataSource {
  return {
    snapshot: async () => snapshot(),
    sessions: async () => ({
      generatedAt: new Date(0).toISOString(),
      sessions: [],
      harnesses: [],
      truncated: false,
    }),
  }
}

function controlsState(stopped: boolean): PanelControls {
  return {
    stopped,
    features: [],
    monitoring: { enabled: true },
    sync: { enabled: true, intervalMs: 30_000 },
    orchestration: {
      desired: false,
      effective: false,
      state: 'stopped',
      url: 'http://127.0.0.1:8789',
    },
    install: { enabled: false },
  }
}

function fakeControls(): { controls: PanelControlService; stops: boolean[] } {
  const stops: boolean[] = []
  const controls = {
    setStopped: async (stopped: boolean) => {
      stops.push(stopped)
      return controlsState(stopped)
    },
  } as unknown as PanelControlService
  return { controls, stops }
}

async function startPanel(controls?: PanelControlService): Promise<PanelFixture> {
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
  })
  servers.push(server)
  databases.push(db)
  return {
    server,
    token: login.token,
    endpoint: { host: '127.0.0.1', port: server.port },
  }
}

function createApi(panel?: () => PanelEndpoint | undefined) {
  const deps: ApiDependencies = {
    harness: {} as HarnessManager,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 0,
    canAccess: () => true,
    sessionCount: () => 0,
    ...(panel ? { panel } : {}),
    log: () => undefined,
  }
  return createApiApp(deps, { token: 'secret' })
}

function tunnel(path: string, init: RequestInit = {}): Request {
  return new Request(`http://clara.local/v1/hub-panel${path}`, {
    ...init,
    headers: {
      'x-clara-agent': '1',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('panel tunnel bridge', () => {
  it('returns a session token for a tunnel login and keeps cookie-only direct login', async () => {
    const panel = await startPanel()
    const api = createApi(() => panel.endpoint)

    const tunneled = await api.fetch(
      tunnel('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-clara-panel': '1' },
        body: JSON.stringify({ username: 'admin', password: 'test-password' }),
      })
    )
    expect(tunneled.status).toBe(200)
    const body = (await tunneled.json()) as { user: { username: string }; sessionToken?: string }
    expect(body.user.username).toBe('admin')
    expect(typeof body.sessionToken).toBe('string')
    expect(tunneled.headers.get('set-cookie')).toBeNull()

    const direct = await fetch(`${panel.server.url}panel/api/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clara-panel': '1' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    })
    expect(direct.status).toBe(200)
    expect(direct.headers.get('set-cookie')).toContain('clara_panel_session=')
    const directBody = (await direct.json()) as { sessionToken?: string }
    expect(directBody.sessionToken).toBeUndefined()
  })

  it('accepts a bearer session for status, password change, and logout', async () => {
    const panel = await startPanel()
    const api = createApi(() => panel.endpoint)

    const status = await api.fetch(
      tunnel('/status', { headers: { authorization: `Bearer ${panel.token}` } })
    )
    expect(status.status).toBe(200)
    expect(((await status.json()) as PanelSnapshot).apiVersion).toBe(PANEL_API_VERSION)

    const changed = await api.fetch(
      tunnel('/account/password', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${panel.token}`,
          'content-type': 'application/json',
          'x-clara-panel': '1',
        },
        body: JSON.stringify({
          currentPassword: 'test-password',
          newPassword: 'a-newer-password',
        }),
      })
    )
    expect(changed.status).toBe(200)
    const changedBody = (await changed.json()) as { sessionToken?: string }
    expect(typeof changedBody.sessionToken).toBe('string')
    const nextToken = changedBody.sessionToken as string
    expect(changed.headers.get('set-cookie')).toBeNull()

    const oldToken = await api.fetch(
      tunnel('/status', { headers: { authorization: `Bearer ${panel.token}` } })
    )
    expect(oldToken.status).toBe(401)

    const loggedOut = await api.fetch(
      tunnel('/session', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${nextToken}`, 'x-clara-panel': '1' },
      })
    )
    expect(loggedOut.status).toBe(200)
    expect(loggedOut.headers.get('set-cookie')).toBeNull()

    const afterLogout = await api.fetch(
      tunnel('/status', { headers: { authorization: `Bearer ${nextToken}` } })
    )
    expect(afterLogout.status).toBe(401)
  })

  it('still accepts the panel session cookie on the served panel', async () => {
    const panel = await startPanel()
    const response = await fetch(`${panel.server.url}panel/api/v1/status`, {
      headers: { cookie: `clara_panel_session=${panel.token}` },
    })
    expect(response.status).toBe(200)
  })

  it('preserves the query string', async () => {
    const panel = await startPanel()
    const api = createApi(() => panel.endpoint)

    const invalid = await api.fetch(
      tunnel('/sessions?limit=abc', { headers: { authorization: `Bearer ${panel.token}` } })
    )
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('invalid_query')

    const valid = await api.fetch(
      tunnel('/sessions?limit=5', { headers: { authorization: `Bearer ${panel.token}` } })
    )
    expect(valid.status).toBe(200)
  })

  it('rejects paths that leave the panel API surface', async () => {
    const panel = await startPanel()
    const api = createApi(() => panel.endpoint)

    const traversal = await api.fetch(tunnel('/%2e%2e%2f%2e%2e%2fhealth'))
    expect(traversal.status).toBe(400)
    expect(((await traversal.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_path'
    )

    const sibling = await api.fetch(
      new Request('http://clara.local/v1/hub-panels/status', {
        headers: { 'x-clara-agent': '1' },
      })
    )
    expect(sibling.status).toBe(404)
  })

  it('returns panel_unavailable when the panel is not running', async () => {
    const api = createApi(() => undefined)
    const response = await api.fetch(tunnel('/status'))
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'panel_unavailable'
    )

    const disabled = createApi()
    expect((await disabled.fetch(tunnel('/status'))).status).toBe(503)
  })

  it('rejects Go offline through the tunnel and forwards Go online', async () => {
    const { controls, stops } = fakeControls()
    const panel = await startPanel(controls)
    const api = createApi(() => panel.endpoint)
    const agent = (stopped: boolean) =>
      api.fetch(
        tunnel('/agent', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${panel.token}`,
            'content-type': 'application/json',
            'x-clara-panel': '1',
          },
          body: JSON.stringify({ stopped }),
        })
      )

    const offline = await agent(true)
    expect(offline.status).toBe(403)
    expect(((await offline.json()) as { error: { code: string } }).error.code).toBe('control_path')
    expect(stops).toEqual([])

    const online = await agent(false)
    expect(online.status).toBe(200)
    expect(stops).toEqual([false])
  })

  it('caps the forwarded body at the panel limit', async () => {
    const panel = await startPanel()
    const api = createApi(() => panel.endpoint)

    const response = await api.fetch(
      tunnel('/features', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${panel.token}`,
          'content-type': 'application/json',
          'x-clara-panel': '1',
        },
        body: JSON.stringify({
          feature: 'relay',
          enabled: false,
          padding: 'x'.repeat(9_000),
        }),
      })
    )
    expect(response.status).toBe(413)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'body_too_large'
    )
  })
})
