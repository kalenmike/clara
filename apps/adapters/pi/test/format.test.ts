import { describe, expect, it } from 'vitest'
import { parseSession, sessionSummary, activeBranch, sessionUsage } from '../src/pi/format.ts'
import { mapTranscript } from '../src/pi/transcript.ts'

const header = {
  type: 'session',
  version: 3,
  id: 'session-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  cwd: '/workspace/project',
}

const entries = [
  header,
  {
    type: 'session_info',
    id: 'a1',
    parentId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    name: 'Shared session',
  },
  {
    type: 'message',
    id: 'a2',
    parentId: 'a1',
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 1_700_000_001_000,
    },
  },
  {
    type: 'message',
    id: 'a3',
    parentId: 'a2',
    timestamp: '2026-01-01T00:00:02.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'working' },
        { type: 'text', text: 'hi' },
        { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls' } },
      ],
      api: 'fake',
      provider: 'fake',
      model: 'fake-model',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 1,
        cacheWrite: 2,
        reasoning: 3,
        cost: { total: 0.02 },
      },
      stopReason: 'toolUse',
      timestamp: 1_700_000_002_000,
    },
  },
  {
    type: 'message',
    id: 'a4',
    parentId: 'a3',
    timestamp: '2026-01-01T00:00:03.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'file.txt' }],
      isError: false,
      timestamp: 1_700_000_003_000,
    },
  },
]

describe('Pi session format', () => {
  it('reads names, models, and usage from a session file', () => {
    const session = parseSession(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    const summary = sessionSummary('/tmp/session.jsonl', session)
    expect(summary.id).toBe('session-1')
    expect(summary.name).toBe('Shared session')
    expect(summary.cwd).toBe('/workspace/project')
    expect(summary.messageCount).toBe(3)
    expect(summary.model).toEqual({ id: 'fake-model', providerID: 'fake' })
    expect(summary.cost).toBeCloseTo(0.02)
    expect(summary.tokens).toMatchObject({
      input: 10,
      output: 5,
      reasoning: 3,
      cache: { read: 1, write: 2 },
    })
  })

  it('follows the active branch', () => {
    const session = parseSession(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    expect(activeBranch(session.entries).map((entry) => entry.id)).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('maps the branch to Clara messages with stable ids', () => {
    const session = parseSession(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    const messages = mapTranscript({ session, providerID: 'fake', agent: 'pi' })
    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
    const assistant = messages[1]
    expect(assistant?.id).toBe('pi-a-1700000002000')
    expect(assistant?.type === 'assistant' && assistant.content).toMatchObject([
      { type: 'reasoning', text: 'working' },
      { type: 'text', text: 'hi' },
      {
        type: 'tool',
        name: 'bash',
        state: { status: 'completed', content: [{ type: 'text', text: 'file.txt' }] },
      },
    ])
  })

  it('reuses Clara inbox ids for prompts sent through the adapter', () => {
    const session = parseSession(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    const messages = mapTranscript({
      session,
      providerID: 'fake',
      agent: 'pi',
      prompts: new Map([[1_700_000_001_000, { id: 'inbox-1', kind: 'user' }]]),
    })
    expect(messages[0]).toMatchObject({ id: 'inbox-1', type: 'user' })
  })

  it('sums full-session usage across entries', () => {
    const session = parseSession(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    const usage = sessionUsage(session.entries)
    expect(usage.cost).toBeCloseTo(0.02)
    expect(usage.tokens.input).toBe(10)
  })
})
