import type { ClaraSession } from '@clara/api-contract'
import { describe, expect, it, vi } from 'vitest'
import type { ClaraClient } from '@/lib/client'
import {
  discardEmptyDraft,
  shouldDiscardEmptyDraft,
  type EmptyDraftStatus,
} from './use-discard-empty-draft'

function session(overrides: Partial<ClaraSession> = {}): ClaraSession {
  return {
    id: 'session-1',
    title: '',
    time: { created: 1, updated: 1 },
    ...overrides,
  } as ClaraSession
}

function status(overrides: Partial<EmptyDraftStatus> = {}): EmptyDraftStatus {
  return {
    sessionID: 'session-1',
    session: session(),
    hasMessages: false,
    hasLocalDraft: false,
    hasRequests: false,
    busy: false,
    worker: false,
    ...overrides,
  }
}

function clientWith(input: { messages?: unknown[]; inbox?: unknown[]; fail?: boolean }): {
  client: ClaraClient
  remove: ReturnType<typeof vi.fn>
} {
  const remove = vi.fn(async () => undefined)
  const list = vi.fn(async () => {
    if (input.fail) throw new Error('unreachable')
    return { data: input.messages ?? [], cursor: {} }
  })
  const inbox = vi.fn(async () => input.inbox ?? [])

  return {
    client: {
      message: { list },
      session: { inbox: { list: inbox }, remove },
    } as unknown as ClaraClient,
    remove,
  }
}

describe('shouldDiscardEmptyDraft', () => {
  it('discards an untitled brief with no content', () => {
    expect(shouldDiscardEmptyDraft(status())).toBe(true)
  })

  it('keeps a brief with a title', () => {
    expect(shouldDiscardEmptyDraft(status({ session: session({ title: 'Fix login' }) }))).toBe(
      false
    )
  })

  it('keeps a brief with messages, a local draft, or a waiting request', () => {
    expect(shouldDiscardEmptyDraft(status({ hasMessages: true }))).toBe(false)
    expect(shouldDiscardEmptyDraft(status({ hasLocalDraft: true }))).toBe(false)
    expect(shouldDiscardEmptyDraft(status({ hasRequests: true }))).toBe(false)
  })

  it('keeps a running, worker, archived, or snoozed brief', () => {
    expect(shouldDiscardEmptyDraft(status({ busy: true }))).toBe(false)
    expect(shouldDiscardEmptyDraft(status({ worker: true }))).toBe(false)
    expect(
      shouldDiscardEmptyDraft(
        status({ session: session({ time: { created: 1, updated: 1, archived: 2 } }) })
      )
    ).toBe(false)
    expect(
      shouldDiscardEmptyDraft(status({ session: session({ metadata: { snoozed: true } }) }))
    ).toBe(false)
  })

  it('keeps a brief that has not loaded', () => {
    expect(shouldDiscardEmptyDraft(status({ session: undefined }))).toBe(false)
  })
})

describe('discardEmptyDraft', () => {
  it('removes a brief that the harness still reports as empty', async () => {
    const { client, remove } = clientWith({})

    await expect(discardEmptyDraft(client, 'session-1', () => true)).resolves.toBe(true)

    expect(remove).toHaveBeenCalledWith({ sessionID: 'session-1' })
  })

  it('keeps a brief with a projected message', async () => {
    const { client, remove } = clientWith({ messages: [{ id: 'message-1' }] })

    await expect(discardEmptyDraft(client, 'session-1', () => true)).resolves.toBe(false)

    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps a brief with a saved draft in the inbox', async () => {
    const { client, remove } = clientWith({ inbox: [{ id: 'draft-1' }] })

    await expect(discardEmptyDraft(client, 'session-1', () => true)).resolves.toBe(false)

    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps a brief that was reused while the check was in flight', async () => {
    const { client, remove } = clientWith({})

    await expect(discardEmptyDraft(client, 'session-1', () => false)).resolves.toBe(false)

    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps a brief when the harness cannot confirm it is empty', async () => {
    const { client, remove } = clientWith({ fail: true })

    await expect(discardEmptyDraft(client, 'session-1', () => true)).resolves.toBe(false)

    expect(remove).not.toHaveBeenCalled()
  })
})
