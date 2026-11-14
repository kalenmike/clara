import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaraEvent } from '@clara/api-contract'
import { chatStore } from './chat-store'

const SESSION = 'ses_status'

function event(type: string, data: Record<string, unknown>): ClaraEvent {
  return { id: 'evt', created: 1, type, data } as unknown as ClaraEvent
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
    callback(0)
    return 0
  })
  chatStore.reset()
})

afterEach(() => {
  chatStore.reset()
  vi.unstubAllGlobals()
})

describe('chatStore status', () => {
  it('keeps the first seeded status', () => {
    chatStore.seedStatus(SESSION, { type: 'busy' })
    chatStore.seedStatus(SESSION, { type: 'idle' })

    expect(chatStore.getSnapshot(SESSION).status).toEqual({ type: 'busy' })
  })

  it('lets a live status event supersede the seed', () => {
    chatStore.seedStatus(SESSION, { type: 'busy' })
    chatStore.dispatch(event('session.status', { sessionID: SESSION, status: { type: 'idle' } }))
    chatStore.seedStatus(SESSION, { type: 'busy' })

    expect(chatStore.getSnapshot(SESSION).status).toEqual({ type: 'idle' })
  })

  it('marks a session busy when a step starts', () => {
    chatStore.seedStatus(SESSION, { type: 'idle' })
    chatStore.dispatch(
      event('session.step.started', {
        sessionID: SESSION,
        assistantMessageID: 'msg_1',
        agent: 'build',
        model: { id: 'model', providerID: 'provider' },
        started: 1,
      })
    )

    expect(chatStore.getSnapshot(SESSION).status).toEqual({ type: 'busy' })
  })

  it('returns to idle when the run ends', () => {
    chatStore.seedStatus(SESSION, { type: 'busy' })
    chatStore.dispatch(event('session.idle', { sessionID: SESSION }))

    expect(chatStore.getSnapshot(SESSION).status).toEqual({ type: 'idle' })
  })

  it('can reseed after a reconnect reset', () => {
    chatStore.seedStatus(SESSION, { type: 'busy' })
    chatStore.resetStatuses()
    chatStore.seedStatus(SESSION, { type: 'idle' })

    expect(chatStore.getSnapshot(SESSION).status).toEqual({ type: 'idle' })
  })
})

describe('chatStore delivered prompts', () => {
  it('keeps a sent prompt until the transcript owns its ID', () => {
    chatStore.dispatch(
      event('session.inbox.delivered', {
        sessionID: SESSION,
        inboxID: 'draft-1',
        item: {
          id: 'draft-1',
          sessionID: SESSION,
          type: 'user',
          delivery: 'steer',
          payload: { text: 'Hello' },
          time: { created: 1 },
        },
      })
    )

    expect(chatStore.getSnapshot(SESSION).sent).toMatchObject([
      { id: 'draft-1', type: 'user', text: 'Hello' },
    ])

    chatStore.hydrate(SESSION, [], null)
    expect(chatStore.getSnapshot(SESSION).sent).toHaveLength(1)

    chatStore.hydrate(
      SESSION,
      [{ id: 'draft-1', type: 'user', text: 'Hello', time: { created: 2 } }],
      null
    )
    expect(chatStore.getSnapshot(SESSION).sent).toHaveLength(0)
    expect(chatStore.getSnapshot(SESSION).messages).toMatchObject([
      { id: 'draft-1', type: 'user', text: 'Hello' },
    ])
  })

  it('does not duplicate a delivered prompt', () => {
    const item = {
      id: 'draft-2',
      sessionID: SESSION,
      type: 'user' as const,
      delivery: 'steer' as const,
      payload: { text: 'Again' },
      time: { created: 1 },
    }
    chatStore.deliverUser(SESSION, item)
    chatStore.deliverUser(SESSION, item)

    expect(chatStore.getSnapshot(SESSION).sent).toHaveLength(1)
  })
})
