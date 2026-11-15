import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaraApiError } from '@clara/api-client'
import type { SessionMailboxSignals } from '@clara/shared-types'
import type { ClaraClient } from '@/lib/client'
import { SESSION_SIGNAL_BATCH_SIZE, loadSessionMailboxSignals } from './session-mailbox-signals'

const signals = (last: SessionMailboxSignals['last']): SessionMailboxSignals => ({
  last,
  awaitingInput: false,
  lastError: false,
  planReply: false,
})

function fakeClient() {
  const signalsMock = vi.fn(async (input: { sessions: Array<{ sessionID: string }> }) => ({
    data: input.sessions.map((session) => ({
      sessionID: session.sessionID,
      signals: signals(session.sessionID === 'user' ? 'user' : 'assistant'),
    })),
  }))
  return {
    client: { session: { signals: signalsMock } } as unknown as ClaraClient,
    signalsMock,
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadSessionMailboxSignals', () => {
  it('coalesces one render burst into a single request', async () => {
    const { client, signalsMock } = fakeClient()

    const first = loadSessionMailboxSignals(client, 'user', 10)
    const second = loadSessionMailboxSignals(client, 'assistant', 20)
    await vi.advanceTimersByTimeAsync(20)

    await expect(first).resolves.toEqual(signals('user'))
    await expect(second).resolves.toEqual(signals('assistant'))
    expect(signalsMock).toHaveBeenCalledTimes(1)
    expect(signalsMock).toHaveBeenCalledWith(
      {
        sessions: [
          { sessionID: 'user', updated: 10 },
          { sessionID: 'assistant', updated: 20 },
        ],
      },
      expect.anything()
    )
  })

  it('splits a batch that exceeds the hub limit', async () => {
    const { client, signalsMock } = fakeClient()
    const total = SESSION_SIGNAL_BATCH_SIZE + 1

    const pending = Array.from({ length: total }, (_, index) =>
      loadSessionMailboxSignals(client, `session-${index}`, index)
    )
    await vi.advanceTimersByTimeAsync(20)
    await Promise.all(pending)

    expect(signalsMock).toHaveBeenCalledTimes(2)
  })

  it('settles an unresolved session as null', async () => {
    const { client } = fakeClient()
    const missing = {
      ...client,
      session: {
        signals: vi.fn(async () => ({ data: [] })),
      },
    } as unknown as ClaraClient

    const pending = loadSessionMailboxSignals(missing, 'gone', 1)
    await vi.advanceTimersByTimeAsync(20)

    await expect(pending).resolves.toBeNull()
  })

  it('drops an aborted session without failing the rest', async () => {
    const { client, signalsMock } = fakeClient()
    const controller = new AbortController()

    const kept = loadSessionMailboxSignals(client, 'kept', 1)
    const dropped = loadSessionMailboxSignals(client, 'dropped', 2, controller.signal)
    controller.abort()
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' })

    await vi.advanceTimersByTimeAsync(20)
    await expect(kept).resolves.toEqual(signals('assistant'))
    expect(signalsMock).toHaveBeenCalledTimes(1)
    expect(signalsMock.mock.calls[0]?.[0]).toEqual({
      sessions: [{ sessionID: 'kept', updated: 1 }],
    })
  })

  it('falls back to per-session reads against a hub without the batch route', async () => {
    const formsList = vi.fn(async () => [])
    const messagesList = vi.fn(async (input: { type: 'user' | 'assistant' }) => ({
      data: [
        input.type === 'user'
          ? { id: 'u1', type: 'user', time: { created: 2 }, text: 'hello' }
          : {
              id: 'a1',
              type: 'assistant',
              time: { created: 1 },
              agent: 'build',
              model: { id: 'm', providerID: 'p' },
              content: [],
              finish: 'stop',
            },
      ],
      cursor: { previous: null, next: null },
    }))
    const client = {
      session: {
        signals: vi.fn(async () => {
          throw new ClaraApiError(404, 'not_found', 'Unknown API endpoint')
        }),
        form: { list: formsList },
      },
      message: { list: messagesList },
    } as unknown as ClaraClient

    const pending = loadSessionMailboxSignals(client, 'legacy', 1)
    await vi.advanceTimersByTimeAsync(20)

    await expect(pending).resolves.toEqual({
      last: 'user',
      awaitingInput: false,
      lastError: false,
      planReply: false,
    })
    expect(formsList).toHaveBeenCalledTimes(1)
    expect(messagesList).toHaveBeenCalledTimes(2)
  })

  it('fails every waiter when the batch request fails', async () => {
    const failing = {
      session: {
        signals: vi.fn(async () => {
          throw new Error('offline')
        }),
      },
    } as unknown as ClaraClient

    const first = loadSessionMailboxSignals(failing, 'a', 1)
    const second = loadSessionMailboxSignals(failing, 'b', 2)
    const firstRejected = expect(first).rejects.toThrow('offline')
    const secondRejected = expect(second).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(20)

    await firstRejected
    await secondRejected
  })
})
