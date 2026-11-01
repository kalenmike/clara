import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PANEL_API_VERSION, type PanelSnapshot } from '@clara/shared-types'
import type { PanelDataSource } from '../src/panel/runtime.ts'
import { startPanelServer, type PanelServer } from '../src/panel/server.ts'

const tempDirs: string[] = []
const servers: PanelServer[] = []

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
    },
    config: {
      opencodeUrl: { value: 'http://127.0.0.1:4096', source: 'default' },
      opencodePassword: { value: false, source: 'none' },
      localHost: { value: '127.0.0.1', source: 'default' },
      localPort: { value: 8788, source: 'default' },
      relayUrl: { value: null, source: 'none' },
      relayRoom: { value: null, source: 'none' },
      pairingBaseUrl: { value: 'https://clara.example', source: 'default' },
    },
    opencode: {
      url: 'http://127.0.0.1:4096',
      passwordConfigured: false,
      reachable: true,
      desired: true,
      effective: true,
      version: '2.1.1',
      latencyMs: 1,
      checkedAt: new Date(0).toISOString(),
      code: 'ok',
    },
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
    },
    storage: [],
    events: [],
  }
}

function source(): PanelDataSource {
  return { snapshot: async () => snapshot() }
}

async function start(assetsDir?: string): Promise<PanelServer> {
  const server = await startPanelServer({ source: source(), port: 0, assetsDir })
  servers.push(server)
  return server
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('panel server', () => {
  it('serves the read-only status snapshot', async () => {
    const server = await start()
    const response = await fetch(`${server.url}panel/api/v1/status`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const body = (await response.json()) as PanelSnapshot
    expect(body.apiVersion).toBe(PANEL_API_VERSION)
    expect(body.agent.version).toBe('0.1.0')
  })

  it('allows HEAD and rejects every mutating method', async () => {
    const server = await start()
    const head = await fetch(`${server.url}panel/api/v1/status`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const post = await fetch(`${server.url}panel/api/v1/status`, { method: 'POST' })
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
    const response = await fetch(`${server.url}panel/api/v1/unknown`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
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
