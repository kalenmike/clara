import { describe, expect, it } from 'vitest'
import {
  apiErrorSchema,
  apiInfoSchema,
  claraEventSchema,
  claraFormSchema,
  claraProjectSchema,
  claraSessionsResponseSchema,
  claraSessionMessageSchema,
  claraSessionSchema,
  claraVcsGetOutputSchema,
  gitCommitSchema,
} from '../src/index.ts'

const project = {
  id: 'p1',
  name: 'Demo',
  time: { created: 1, updated: 2, active: 3 },
  defaultWorkspaceID: 'w1',
  workspaces: [
    {
      id: 'w1',
      harnessID: 'h1',
      harnessKind: 'opencode',
      harnessLabel: 'OpenCode',
      online: true,
      active: true,
      directory: '/workspace/demo',
      canonical: '/workspace/demo',
      projectIDs: ['hp1'],
      linked: true,
    },
  ],
}

const session = {
  id: 's1',
  projectID: 'p1',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: '/workspace/demo' },
}

describe('api contract', () => {
  it('validates Clara project and session DTOs', () => {
    expect(claraProjectSchema.safeParse(project).success).toBe(true)
    expect(claraSessionSchema.safeParse(session).success).toBe(true)
    expect(
      claraSessionSchema.safeParse({ ...session, harnessID: 'h1', workspaceID: 'w1' }).success
    ).toBe(true)
  })

  it('accepts per-harness status on a project session page', () => {
    expect(
      claraSessionsResponseSchema.safeParse({
        data: [session],
        cursor: { previous: null, next: null },
        harnesses: [
          {
            harnessID: 'h1',
            label: 'OpenCode',
            kind: 'opencode',
            online: true,
            ok: true,
          },
          {
            harnessID: 'h2',
            label: 'Claude',
            kind: 'claude',
            online: false,
            ok: false,
            code: 'offline',
            message: 'The harness adapter is offline',
          },
        ],
      }).success
    ).toBe(true)
  })

  it('accepts every Clara message shape', () => {
    expect(
      claraSessionMessageSchema.safeParse({
        id: 'm1',
        type: 'assistant',
        time: { created: 1 },
        agent: 'build',
        model: { id: 'model', providerID: 'provider' },
        content: [{ type: 'text', text: 'hello' }],
      }).success
    ).toBe(true)
  })

  it('validates Clara events', () => {
    expect(
      claraEventSchema.safeParse({
        id: 'e1',
        created: 1,
        type: 'session.idle',
        data: { sessionID: 's1' },
      }).success
    ).toBe(true)
    expect(
      claraEventSchema.safeParse({
        id: 'e2',
        created: 1,
        type: 'session.status',
        data: { sessionID: 's1', status: { type: 'busy' } },
      }).success
    ).toBe(true)
  })

  it('validates forms and VCS wrappers', () => {
    expect(
      claraFormSchema.safeParse({
        id: 'f1',
        sessionID: 's1',
        title: 'Question',
        fields: [
          {
            key: 'answer',
            type: 'string',
          },
        ],
      }).success
    ).toBe(true)
    expect(
      claraVcsGetOutputSchema.safeParse({
        location: { directory: '/workspace/demo' },
        data: { branch: { current: 'main', default: 'main' } },
      }).success
    ).toBe(true)
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
