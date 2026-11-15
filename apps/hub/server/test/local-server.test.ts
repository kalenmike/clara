import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '../src/agent.ts'
import type { ApiApp } from '../src/api/context.ts'
import { LocalTransport } from '../src/local-server.ts'

const agents: LocalTransport[] = []

function transport(hosts: string[]): LocalTransport {
  const value = new LocalTransport({
    host: hosts[0] ?? '127.0.0.1',
    hosts,
    port: 0,
    agent: {
      handleMessage: () => undefined,
      disconnect: () => undefined,
      reset: () => undefined,
    } as unknown as Agent,
    api: {
      fetch: async () => new Response('ok'),
    } as unknown as ApiApp,
    sockets: new Set(),
    log: () => undefined,
  })
  agents.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((value) => value.stop()))
})

describe('LocalTransport', () => {
  it('keeps the primary listener when an extra address cannot bind', async () => {
    const value = transport(['127.0.0.1', '203.0.113.1'])
    await value.start()

    expect(value.active).toBe(true)
    expect(value.hosts).toEqual(['127.0.0.1'])
    expect(value.port).toBeGreaterThan(0)
  })

  it('rebinds on the same port after the access mode changes', async () => {
    const value = transport(['127.0.0.1'])
    await value.start()
    const port = value.port
    await value.stop()

    value.setHosts(['127.0.0.1'])
    await value.start()

    expect(value.active).toBe(true)
    expect(value.hosts).toEqual(['127.0.0.1'])
    expect(value.port).toBe(port)
  })
})
