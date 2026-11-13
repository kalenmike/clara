import { describe, expect, it } from 'vitest'
import { createAdapterApp } from '../src/handler.ts'
import { EventBus } from '../src/events.ts'
import { FakeClaudeGateway } from './fake-claude.ts'

const INFO = {
  adapter: { name: 'claude', version: '0.1.0' },
  harness: { kind: 'claude', version: '2.1.325' },
  capabilities: { sessions: true },
}

function app(gateway = new FakeClaudeGateway()) {
  return createAdapterApp({ claude: gateway, info: INFO, events: new EventBus() })
}

describe('Claude adapter handler', () => {
  it('returns adapter info without touching the harness', async () => {
    const gateway = new FakeClaudeGateway()
    const response = await app(gateway).request('/harness/v1/info')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ protocol: 1, ...INFO })
  })

  it('returns the live probe as health', async () => {
    const response = await app().request('/harness/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, version: '2.1.325' })
  })

  it('resolves a location to its canonical directory and project id', async () => {
    const response = await app().request('/harness/v1/locations?directory=/tmp')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      directory: '/tmp',
      project: { id: '/tmp', directory: '/tmp', canonical: '/tmp' },
    })
  })

  it('reports a missing directory as a location error', async () => {
    const response = await app().request('/harness/v1/locations?directory=/definitely/missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'LocationNotFoundError' },
    })
  })

  it('keeps empty stubs in the shapes the hub validates', async () => {
    const handler = app()
    expect(await (await handler.request('/harness/v1/sessions')).json()).toEqual({
      data: [],
      cursor: { previous: null, next: null },
    })
    expect(await (await handler.request('/harness/v1/projects')).json()).toEqual([])
    expect(await (await handler.request('/harness/v1/sessions/active')).json()).toEqual({})
  })
})
