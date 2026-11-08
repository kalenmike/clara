import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { V2Event } from '@opencode/client'
import { chatStore } from './chat-store'

const SESSION = 'ses_status'

function event(type: string, data: Record<string, unknown>): V2Event {
  return { id: 'evt', created: 1, type, data } as unknown as V2Event
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
