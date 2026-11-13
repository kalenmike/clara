import { describe, expect, it } from 'vitest'
import { claraActivitySessionsResponseSchema, claraPlanTodoSchema } from '../src/index.ts'

const session = {
  id: 's1',
  projectID: 'p1',
  cost: 0.25,
  tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: '/workspace/demo' },
}

describe('activity contract', () => {
  it('validates plan todos', () => {
    expect(
      claraPlanTodoSchema.safeParse({ content: 'Ship it', status: 'in_progress' }).success
    ).toBe(true)
    expect(claraPlanTodoSchema.safeParse({ content: 'Ship it', status: 'archived' }).success).toBe(
      false
    )
  })

  it('validates inbox and outbox sessions with partial harness status', () => {
    const parsed = claraActivitySessionsResponseSchema.safeParse({
      data: [
        {
          harnessID: 'harness-a',
          session,
          mailbox: 'outbox',
          todos: [{ content: 'Ship it', status: 'in_progress' }],
        },
        {
          harnessID: 'harness-a',
          session: { ...session, id: 's2' },
          mailbox: 'inbox',
          todosUnavailable: true,
        },
        {
          harnessID: 'harness-a',
          session: { ...session, id: 's3' },
          mailbox: 'inbox',
          todosSkipped: true,
        },
      ],
      harnesses: [
        {
          harnessID: 'harness-a',
          kind: 'opencode',
          label: 'Workstation',
          online: true,
          active: true,
          ok: true,
          createdAt: 1,
        },
        {
          harnessID: 'harness-b',
          kind: 'opencode',
          label: 'Laptop',
          online: false,
          active: false,
          ok: false,
          createdAt: 2,
          code: 'offline',
          message: 'The harness adapter is offline',
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects an unknown mailbox', () => {
    const parsed = claraActivitySessionsResponseSchema.safeParse({
      data: [{ harnessID: 'harness-a', session, mailbox: 'draft' }],
      harnesses: [],
    })

    expect(parsed.success).toBe(false)
  })
})
