import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClaraEvent } from '@clara/api-contract'
import { EventBus } from '../src/events.ts'
import { ClaudeRuntime } from '../src/runtime.ts'
import { SessionService } from '../src/sessions.ts'
import { SessionStore } from '../src/store.ts'
import { FakeClaudeGateway } from './fake-claude.ts'

function fixture() {
  const gateway = new FakeClaudeGateway()
  const events = new EventBus()
  const received: ClaraEvent[] = []
  events.subscribe((event) => received.push(event))
  const store = new SessionStore(join(tmpdir(), `clara-claude-runtime-${randomUUID()}.json`))
  const sessions = new SessionService(gateway, store, '0.1.0', (event) => events.publish(event))
  const runtime = new ClaudeRuntime(gateway, sessions, events, {})
  return { gateway, events, received, store, sessions, runtime }
}

function waitFor(received: ClaraEvent[], type: ClaraEvent['type']) {
  return new Promise<ClaraEvent>((resolve) => {
    const timer = setInterval(() => {
      const event = received.find((item) => item.type === type)
      if (event) {
        clearInterval(timer)
        resolve(event)
      }
    }, 5)
  })
}

async function create(runtime: SessionService) {
  return runtime.create({ location: { directory: '/tmp' } })
}

describe('Claude runtime', () => {
  it('streams text, usage, and an idle turn', async () => {
    const { gateway, received, sessions, runtime } = fixture()
    const session = await create(sessions)
    const sessionId = session.id
    gateway.script = async (request, emit) => {
      emit({
        type: 'init',
        sessionId,
        model: 'claude-sonnet',
        version: '2.1.325',
        cwd: '/tmp',
        tools: [],
        agents: [],
        commands: [],
        skills: [],
        permissionMode: 'default',
        provider: gateway.providerValue,
      })
      emit({ type: 'message-start', assistantMessageID: 'a1', model: 'claude-sonnet' })
      emit({ type: 'text-started', assistantMessageID: 'a1', ordinal: 0 })
      emit({ type: 'text-delta', assistantMessageID: 'a1', ordinal: 0, delta: 'Hello' })
      emit({ type: 'text-ended', assistantMessageID: 'a1', ordinal: 0, text: 'Hello' })
      emit({
        type: 'assistant',
        assistantMessageID: 'a1',
        model: 'claude-sonnet',
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1 },
        aborted: false,
      })
      emit({
        type: 'result',
        subtype: 'success',
        sessionId,
        costUsd: 0.01,
        usage: { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1 },
        modelUsage: {
          'claude-sonnet': { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1 },
        },
        errors: [],
        aborted: false,
        userMessageID: request.sessionId,
      })
    }

    const prompt = await runtime.prompt(sessionId, { text: 'Hi' })
    await waitFor(received, 'session.idle')

    expect(prompt).toMatchObject({ type: 'user', payload: { text: 'Hi' } })
    expect(received.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'session.execution.started',
        'session.step.started',
        'session.text.delta',
        'session.step.ended',
        'session.usage.updated',
        'session.execution.succeeded',
        'session.idle',
      ])
    )
    const step = received.find((event) => event.type === 'session.step.started')
    expect(step).toMatchObject({ data: { model: { providerID: 'anthropic' } } })
    const delivered = received.find((event) => event.type === 'session.inbox.delivered')
    expect(delivered).toMatchObject({
      data: { inboxID: prompt.id, item: { id: prompt.id, type: 'user', payload: { text: 'Hi' } } },
    })
    expect(gateway.turns[0]?.userMessageID).toBe(prompt.id)
    expect((await sessions.get(sessionId)).cost).toBe(0.01)
  })

  it('uses the resolved provider and default model', async () => {
    const { gateway, received, sessions, runtime } = fixture()
    gateway.providerValue = { id: 'ollama', name: 'Ollama' }
    gateway.defaultModelValue = 'gemma4:26b'
    const session = await create(sessions)
    const sessionId = session.id
    gateway.script = async (request, emit) => {
      emit({
        type: 'init',
        sessionId,
        model: 'gemma4:26b',
        version: '2.1.325',
        cwd: '/tmp',
        tools: [],
        agents: [],
        commands: [],
        skills: [],
        permissionMode: 'default',
        provider: gateway.providerValue,
      })
      emit({ type: 'message-start', assistantMessageID: 'a1', model: 'gemma4:26b' })
      emit({
        type: 'assistant',
        assistantMessageID: 'a1',
        model: 'gemma4:26b',
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        aborted: false,
      })
      emit({
        type: 'result',
        subtype: 'success',
        sessionId: request.sessionId,
        costUsd: 0,
        usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        modelUsage: {
          'gemma4:26b': { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
        errors: [],
        aborted: false,
      })
    }

    await runtime.prompt(sessionId, { text: 'Hi' })
    await waitFor(received, 'session.idle')

    expect(gateway.turns[0]?.model).toBe('gemma4:26b')
    const step = received.find((event) => event.type === 'session.step.started')
    expect(step).toMatchObject({
      data: { model: { id: 'gemma4:26b', providerID: 'ollama' } },
    })
    expect((await sessions.get(sessionId)).model).toMatchObject({
      id: 'gemma4:26b',
      providerID: 'ollama',
    })
  })

  it('round-trips a permission request', async () => {
    const { gateway, received, sessions, runtime } = fixture()
    const session = await create(sessions)
    const sessionId = session.id
    let decision: { behavior: string } | undefined
    gateway.script = async (request, emit) => {
      decision = await request.onPermission({
        id: 'permission',
        toolName: 'Bash',
        input: { command: 'ls' },
        toolUseID: 't1',
        signal: new AbortController().signal,
      })
      emit({ type: 'message-start', assistantMessageID: 'a1', model: 'claude-sonnet' })
      emit({
        type: 'result',
        subtype: 'success',
        sessionId,
        costUsd: 0,
        usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        modelUsage: {},
        errors: [],
        aborted: false,
      })
    }

    await runtime.prompt(sessionId, { text: 'Run it' })
    const asked = await waitFor(received, 'permission.asked')
    if (asked.type !== 'permission.asked') throw new Error('missing permission event')
    await runtime.replyPermission(sessionId, asked.data.id, 'once')
    await waitFor(received, 'session.idle')

    expect(decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(received.map((event) => event.type)).toContain('permission.replied')
  })
})

describe('Claude question forms', () => {
  it('maps AskUserQuestion to a Clara form and returns answers', async () => {
    const { gateway, received, sessions, runtime } = fixture()
    const session = await create(sessions)
    const sessionId = session.id
    let decision: { behavior: string; updatedInput?: Record<string, unknown> } | undefined
    gateway.script = async (request, emit) => {
      decision = await request.onPermission({
        id: 'question',
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Continue?',
              header: 'Continue',
              options: [{ label: 'Yes' }, { label: 'No' }],
              multiSelect: false,
            },
          ],
        },
        toolUseID: 'q1',
        signal: new AbortController().signal,
      })
      emit({
        type: 'result',
        subtype: 'success',
        sessionId,
        costUsd: 0,
        usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        modelUsage: {},
        errors: [],
        aborted: false,
      })
    }

    await runtime.prompt(sessionId, { text: 'Ask me' })
    const created = await waitFor(received, 'form.created')
    if (created.type !== 'form.created') throw new Error('missing form')
    expect(created.data.form.fields[0]).toMatchObject({
      key: 'q0',
      type: 'string',
      title: 'Continue',
      options: [{ value: 'Yes' }, { value: 'No' }],
    })

    await runtime.replyForm(sessionId, created.data.form.id, { q0: 'Yes' })
    await waitFor(received, 'session.idle')

    expect(decision).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Continue?': 'Yes' } },
    })
  })
})
