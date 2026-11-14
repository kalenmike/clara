import type { ClaraSession } from '@clara/api-contract'
import type { SessionMailboxSignals } from '@clara/shared-types'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT_GRACE_MS,
  shouldPruneEmptyDraft,
  type PruneEmptyDraftStatus,
} from './use-prune-empty-drafts'

function session(overrides: Partial<ClaraSession> = {}): ClaraSession {
  return {
    id: 'session-1',
    title: '',
    time: { created: 1, updated: 1 },
    ...overrides,
  } as ClaraSession
}

function signals(overrides: Partial<SessionMailboxSignals> = {}): SessionMailboxSignals {
  return {
    last: 'none',
    awaitingInput: false,
    lastError: false,
    planReply: false,
    ...overrides,
  }
}

function status(overrides: Partial<PruneEmptyDraftStatus> = {}): PruneEmptyDraftStatus {
  return {
    session: session(),
    signals: signals(),
    running: false,
    hasLocalDraft: false,
    now: 1 + EMPTY_DRAFT_GRACE_MS,
    ...overrides,
  }
}

describe('shouldPruneEmptyDraft', () => {
  it('prunes an old untitled brief with no conversation', () => {
    expect(shouldPruneEmptyDraft(status())).toBe(true)
  })

  it('keeps a titled brief', () => {
    expect(shouldPruneEmptyDraft(status({ session: session({ title: 'Fix login' }) }))).toBe(false)
  })

  it('keeps an archived or snoozed brief', () => {
    expect(
      shouldPruneEmptyDraft(
        status({ session: session({ time: { created: 1, updated: 1, archived: 2 } }) })
      )
    ).toBe(false)
    expect(
      shouldPruneEmptyDraft(status({ session: session({ metadata: { snoozed: true } }) }))
    ).toBe(false)
  })

  it('keeps a brief with a user or assistant message', () => {
    expect(shouldPruneEmptyDraft(status({ signals: signals({ last: 'user' }) }))).toBe(false)
    expect(shouldPruneEmptyDraft(status({ signals: signals({ last: 'assistant' }) }))).toBe(false)
  })

  it('keeps a brief with a waiting request', () => {
    expect(shouldPruneEmptyDraft(status({ signals: signals({ awaitingInput: true }) }))).toBe(false)
  })

  it('keeps a running brief and a brief with local content', () => {
    expect(shouldPruneEmptyDraft(status({ running: true }))).toBe(false)
    expect(shouldPruneEmptyDraft(status({ hasLocalDraft: true }))).toBe(false)
  })

  it('keeps a brief that is still inside the grace period', () => {
    expect(shouldPruneEmptyDraft(status({ now: 1 + EMPTY_DRAFT_GRACE_MS - 1 }))).toBe(false)
  })

  it('keeps a brief whose mailbox signals have not loaded', () => {
    expect(shouldPruneEmptyDraft(status({ signals: undefined }))).toBe(false)
  })
})
