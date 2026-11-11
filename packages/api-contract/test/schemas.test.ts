import { describe, expect, it } from 'vitest'
import { apiErrorSchema, apiInfoSchema, gitCommitSchema, openApiSchemas } from '../src/index.ts'

describe('api contract', () => {
  it('ships generated OpenAPI components for the pinned client types', () => {
    expect(openApiSchemas.Project).toBeDefined()
    expect(openApiSchemas.SessionInfo).toBeDefined()
    expect(openApiSchemas.SessionMessagesResponse).toBeDefined()
    expect(openApiSchemas.ServerInfo).toBeDefined()
    expect(openApiSchemas.VcsGetOutput).toBeDefined()
  })

  it('validates hub info', () => {
    const parsed = apiInfoSchema.safeParse({
      server: { version: '0.1.0', protocol: 1, startedAt: 1, pid: 2 },
      harness: {
        configured: true,
        generation: 1,
        active: { kind: 'opencode', label: 'Test' },
        lastError: null,
      },
      agent: { version: '0.1.0', protocol: 1 },
      api: { version: 'v1', openapi: '/openapi.json', docs: '/docs' },
    })
    expect(parsed.success).toBe(true)
  })

  it('validates Git commits and errors', () => {
    expect(
      gitCommitSchema.safeParse({
        hash: 'abc1234',
        authorName: 'A',
        authorEmail: 'a@example.com',
        authoredAt: '2026-01-01T00:00:00.000Z',
        subject: 'feat: test',
        body: '',
      }).success
    ).toBe(true)
    expect(
      apiErrorSchema.safeParse({ error: { code: 'not_found', message: 'missing' } }).success
    ).toBe(true)
  })
})
