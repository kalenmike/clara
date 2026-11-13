import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdapterApp } from '../src/handler.ts'
import { EventBus } from '../src/events.ts'
import { SessionService } from '../src/sessions.ts'
import { SessionStore } from '../src/store.ts'
import { FakeClaudeGateway } from './fake-claude.ts'

const INFO = {
  adapter: { name: 'claude', version: '0.1.0' },
  harness: { kind: 'claude', version: '2.1.325' },
  capabilities: { sessions: true },
}

function fixture(gateway = new FakeClaudeGateway()) {
  const store = new SessionStore(join(tmpdir(), `clara-claude-${randomUUID()}.json`))
  const sessions = new SessionService(gateway, store, '0.1.0', () => {})
  return {
    gateway,
    store,
    sessions,
    app: createAdapterApp({ claude: gateway, sessions, info: INFO, events: new EventBus() }),
  }
}

describe('Claude adapter handler', () => {
  it('returns adapter info without touching the harness', async () => {
    const { app } = fixture()
    const response = await app.request('/harness/v1/info')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ protocol: 1, ...INFO })
  })

  it('returns the live probe as health', async () => {
    const response = await fixture().app.request('/harness/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, version: '2.1.325' })
  })

  it('resolves a location to its canonical directory and project id', async () => {
    const response = await fixture().app.request('/harness/v1/locations?directory=/tmp')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      directory: '/tmp',
      project: { id: '/tmp', directory: '/tmp', canonical: '/tmp' },
    })
  })

  it('reports a missing directory as a location error', async () => {
    const response = await fixture().app.request(
      '/harness/v1/locations?directory=/definitely/missing'
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'LocationNotFoundError' },
    })
  })

  it('creates and lists a session through the harness routes', async () => {
    const { app } = fixture()
    const created = await app.request('/harness/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'First', location: { directory: '/tmp' } }),
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as { id: string; title: string }
    expect(session.title).toBe('First')

    const listed = await app.request('/harness/v1/sessions?project=/tmp')
    expect(await listed.json()).toMatchObject({
      data: [{ id: session.id, title: 'First', projectID: '/tmp' }],
    })

    const read = await app.request(`/harness/v1/sessions/${session.id}`)
    expect(await read.json()).toMatchObject({ id: session.id, title: 'First' })
  })
})
