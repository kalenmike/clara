import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createClaraApiServer } from '../src/server.ts'
import type { ClaraApiReadBackend, SessionListQuery } from '../src/types.ts'

function backend() {
  const calls: SessionListQuery[] = []
  const value: ClaraApiReadBackend = {
    info: async () => ({ api: { version: 'v1' } }),
    openapi: async () => ({ openapi: '3.1.0' }),
    harnessInfo: async () => ({ version: '9.9.9' }),
    projects: async () => [{ id: 'p1' }],
    sessions: async (input) => {
      if (input) calls.push(input)
      return { data: [{ id: 's1' }], cursor: {} }
    },
    activeSessions: async () => ({}),
    session: async () => ({ id: 's1' }),
    messages: async () => ({ data: [], cursor: {} }),
    permissions: async () => ({ data: [] }),
    forms: async () => [],
    inbox: async () => [],
    agents: async () => ({ data: [] }),
    models: async () => ({ data: [] }),
    providers: async () => ({ data: [] }),
    commands: async () => ({ data: [] }),
    skills: async () => ({ data: [] }),
    references: async () => ({ data: [] }),
    location: async () => ({ directory: '/demo' }),
    files: async () => ({ data: [] }),
    vcs: async () => ({ data: null }),
    vcsBase: async () => ({ data: null }),
    vcsStatus: async () => ({ data: [] }),
    vcsDiff: async () => ({ data: [] }),
    worktrees: async () => [],
    gitLog: async () => [],
  }
  return { value, calls }
}

describe('Clara API MCP server', () => {
  it('exposes read-only tools and maps session filters', async () => {
    const fake = backend()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createClaraApiServer(fake.value)
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(clientTransport)

    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    expect(names).toContain('clara_projects_list')
    expect(names).toContain('clara_sessions_list')
    expect(names).toContain('clara_messages_list')
    expect(names).toContain('clara_git_log')
    expect(names).not.toContain('clara_prompt')
    expect(names).not.toContain('clara_delete_session')

    const projects = await client.callTool({ name: 'clara_projects_list', arguments: {} })
    expect(projects.isError).toBeFalsy()
    expect(projects.structuredContent).toEqual({ items: [{ id: 'p1' }] })

    const sessions = await client.callTool({
      name: 'clara_sessions_list',
      arguments: { project: 'p1', parent_id: 'parent-1', archived: false },
    })
    expect(sessions.isError).toBeFalsy()
    expect(fake.calls[0]).toEqual({ project: 'p1', parentID: 'parent-1', archived: false })

    await client.close()
    await server.close()
  })
})
