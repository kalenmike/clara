import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startStaticServer, type StaticServer } from '../src/serve/static.ts'

let dir: string
let server: StaticServer

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clara-web-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Clara</title>')
  writeFileSync(join(dir, 'sw.js'), 'self.skipWaiting()')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
  server = await startStaticServer({ root: dir, port: 0 })
})

afterAll(async () => {
  await server.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('web static server', () => {
  it('serves the health endpoint', async () => {
    const response = await fetch(`${server.url}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'clara-web' })
  })

  it('falls back to the app shell for client routes', async () => {
    const response = await fetch(`${server.url}/sessions/123`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Clara')
    expect(response.headers.get('cache-control')).toBe('no-cache, max-age=0, must-revalidate')
  })

  it('caches hashed assets for a year', async () => {
    const response = await fetch(`${server.url}/assets/app.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-type')).toContain('text/javascript')
  })

  it('sends the security headers', async () => {
    const response = await fetch(`${server.url}/`)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('does not serve files outside the root', async () => {
    const response = await fetch(`${server.url}/..%2f..%2fetc%2fpasswd`)
    expect(response.status).toBe(404)
  })
})
