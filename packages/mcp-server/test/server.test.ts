import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createClaraServer } from '../src/server.ts'
import type { ClaraBackend } from '../src/types.ts'

function backend(): ClaraBackend {
  return {
    list: async () => [{ id: 1, state: 'running' }],
    inbox: async () => [{ id: 7, kind: 'failure' }],
    adapters: async () => [{ id: 'adapter-1' }],
    catalog: async () => [{ id: 'software' }],
  } as unknown as ClaraBackend
}

describe('Clara MCP server', () => {
  it('wraps array results in a structured record', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createClaraServer(backend())
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(clientTransport)

    const list = await client.callTool({ name: 'clara_list', arguments: {} })
    expect(list.isError).toBeFalsy()
    expect(list.structuredContent).toEqual({ items: [{ id: 1, state: 'running' }] })

    const inbox = await client.callTool({ name: 'clara_inbox', arguments: {} })
    expect(inbox.isError).toBeFalsy()
    expect(inbox.structuredContent).toEqual({ items: [{ id: 7, kind: 'failure' }] })

    await client.close()
    await server.close()
  })

  it('does not expose the fragile run_pipeline prompt', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createClaraServer(backend())
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(clientTransport)

    expect(client.getServerCapabilities()?.prompts).toBeUndefined()

    await client.close()
    await server.close()
  })
})
