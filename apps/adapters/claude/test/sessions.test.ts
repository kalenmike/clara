import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionService } from '../src/sessions.ts'
import { SessionStore } from '../src/store.ts'
import { FakeClaudeGateway } from './fake-claude.ts'

function service(gateway = new FakeClaudeGateway()) {
  const store = new SessionStore(join(tmpdir(), `clara-claude-sessions-${randomUUID()}.json`))
  return {
    gateway,
    store,
    sessions: new SessionService(gateway, store, '0.1.0', () => {}),
  }
}

describe('Claude sessions', () => {
  it('merges sidecar sessions with Claude transcripts', async () => {
    const sessionId = randomUUID()
    const { gateway, sessions } = service()
    gateway.sessions = [
      {
        sessionId,
        summary: 'From Claude',
        lastModified: Date.now(),
        createdAt: Date.now(),
        cwd: '/tmp',
      },
    ]

    const created = await sessions.create({
      title: 'From Clara',
      location: { directory: '/tmp' },
    })
    const listed = await sessions.list({ project: '/tmp' })

    expect(listed.data.map((session) => session.id)).toEqual(
      expect.arrayContaining([sessionId, created.id])
    )
    expect(listed.data.find((session) => session.id === sessionId)?.title).toBe('From Claude')
  })

  it('maps prompts, assistant text, and tool results', async () => {
    const sessionId = randomUUID()
    const { gateway, sessions } = service()
    gateway.sessions = [
      {
        sessionId,
        summary: 'Hello',
        lastModified: 10,
        createdAt: 1,
        cwd: '/tmp',
      },
    ]
    gateway.messages = [
      {
        type: 'user',
        uuid: 'u1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: { role: 'user', content: 'Hello' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: {
          role: 'assistant',
          model: 'claude-sonnet',
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Checking' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file.txt' }],
        },
      },
    ]

    const page = await sessions.messages(sessionId, {})
    const user = page.data.find((message) => message.type === 'user')
    const assistant = page.data.find((message) => message.type === 'assistant')

    expect(user).toMatchObject({ text: 'Hello' })
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type !== 'assistant') throw new Error('missing assistant')
    expect(assistant.content[0]).toMatchObject({ type: 'text', text: 'Checking' })
    const tool = assistant.content.find((part) => part.type === 'tool')
    expect(tool).toMatchObject({
      id: 't1',
      name: 'Bash',
      state: { status: 'completed', content: [{ type: 'text', text: 'file.txt' }] },
    })
  })

  it('groups assistant blocks that share an API message id', async () => {
    const sessionId = randomUUID()
    const { gateway, sessions } = service()
    gateway.sessions = [
      {
        sessionId,
        summary: 'Grouped',
        lastModified: 10,
        createdAt: 1,
        cwd: '/tmp',
      },
    ]
    gateway.messages = [
      {
        type: 'user',
        uuid: 'u1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: { role: 'user', content: 'Hello' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet',
          stop_reason: null,
          content: [{ type: 'thinking', thinking: 'Let me think' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Done' }],
        },
      },
    ]

    const page = await sessions.messages(sessionId, { order: 'asc' })
    const assistants = page.data.filter((message) => message.type === 'assistant')

    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({
      id: 'msg_1',
      content: [
        { type: 'reasoning', text: 'Let me think' },
        { type: 'text', text: 'Done' },
      ],
      native: { transcriptID: 'a2' },
    })
  })

  it('anchors a message fork to the selected transcript entry', async () => {
    const sessionId = randomUUID()
    const { gateway, sessions } = service()
    gateway.sessions = [
      {
        sessionId,
        summary: 'Original',
        lastModified: 10,
        createdAt: 1,
        cwd: '/tmp',
      },
    ]
    gateway.messages = [
      {
        type: 'user',
        uuid: 'u1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: { role: 'user', content: 'First' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Reply' }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        sessionId,
        parentToolUseID: null,
        parentAgentID: null,
        message: { role: 'user', content: 'Second' },
      },
    ]

    await sessions.fork(sessionId, 'u2')

    expect(gateway.forkInputs[0]?.input?.upToMessageId).toBe('a1')
  })

  it('forks and moves a session', async () => {
    const sessionId = randomUUID()
    const { gateway, sessions } = service()
    gateway.sessions = [
      {
        sessionId,
        summary: 'Original',
        lastModified: 10,
        createdAt: 1,
        cwd: '/tmp',
      },
    ]

    const forked = await sessions.fork(sessionId)
    expect(forked.id).toBe('forked-session')

    await sessions.move(sessionId, '/var/tmp')
    const moved = await sessions.get(sessionId)
    expect(moved.location.directory).toBe('/var/tmp')
    expect(moved.projectID).toBe('/var/tmp')
  })
})
