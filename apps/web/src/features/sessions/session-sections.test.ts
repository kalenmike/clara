import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import type { SessionMailboxSignals } from '@clara/shared-types'
import { groupSessionsByMailbox, mergeSessionLists, mergeSessionPages } from './session-sections'

function session(
  id: string,
  updated: number,
  metadata?: ClaraSession['metadata'],
  archived?: number
): ClaraSession {
  return {
    id,
    metadata,
    time: { created: updated, updated, ...(archived ? { archived } : {}) },
  } as ClaraSession
}

const signals = new Map()
const running = undefined
const awaitingInput = new Set<string>()

describe('groupSessionsByMailbox', () => {
  it('splits sessions into the mailbox sections', () => {
    const active = session('active', 4)
    const archived = session('archived', 3, {}, 300)
    const snoozed = session('snoozed', 2, { snoozed: true })
    const human = session('human', 1, {})

    const groups = groupSessionsByMailbox(
      [active, archived, snoozed, human],
      signals,
      running,
      awaitingInput
    )

    expect(groups.inbox.map((item) => item.id)).toEqual(['active', 'human'])
    expect(groups.archived.map((item) => item.id)).toEqual(['archived'])
    expect(groups.snoozed.map((item) => item.id)).toEqual(['snoozed'])
    expect(groups.outbox).toHaveLength(0)
    expect(groups.drafts).toHaveLength(0)
  })

  it('keeps archived sessions out of Snoozed and newest first', () => {
    const older = session('older', 2)
    const newer = session('newer', 5)
    const archived = session('archived', 4, { snoozed: true }, 300)

    const groups = groupSessionsByMailbox([older, archived, newer], signals, running, awaitingInput)

    expect(groups.inbox.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(groups.archived.map((item) => item.id)).toEqual(['archived'])
    expect(groups.snoozed).toHaveLength(0)
  })

  it('keeps archived and snoozed sessions from the full merge', () => {
    const active = session('active', 4)
    const archived = session('archived', 3, {}, 300)
    const snoozed = session('snoozed', 2, { snoozed: true })

    const groups = groupSessionsByMailbox(
      mergeSessionLists([active, snoozed], [archived]),
      signals,
      running,
      awaitingInput
    )

    expect(groups.inbox.map((item) => item.id)).toEqual(['active'])
    expect(groups.archived.map((item) => item.id)).toEqual(['archived'])
    expect(groups.snoozed.map((item) => item.id)).toEqual(['snoozed'])
  })

  it('prefers the archived copy of a session returned by both lists', () => {
    const active = session('shared', 4)
    const archived = session('shared', 3, {}, 300)

    const merged = mergeSessionLists([active], [archived])

    expect(merged).toEqual([archived])
  })

  it('keeps a running session in Inbox while it waits on a form', () => {
    const blocked = session('blocked', 4)
    const signals: ReadonlyMap<string, SessionMailboxSignals> = new Map([
      ['blocked', { last: 'assistant', awaitingInput: true, lastError: false, planReply: false }],
    ])

    const groups = groupSessionsByMailbox(
      [blocked],
      signals,
      { blocked: { type: 'running' } },
      new Set()
    )

    expect(groups.inbox.map((item) => item.id)).toEqual(['blocked'])
    expect(groups.outbox).toHaveLength(0)
  })

  it('keeps a running session in Outbox when nothing waits on the person', () => {
    const working = session('working', 4)
    const signals: ReadonlyMap<string, SessionMailboxSignals> = new Map([
      ['working', { last: 'assistant', awaitingInput: false, lastError: false, planReply: false }],
    ])

    const groups = groupSessionsByMailbox(
      [working],
      signals,
      { working: { type: 'running' } },
      new Set()
    )

    expect(groups.outbox.map((item) => item.id)).toEqual(['working'])
    expect(groups.inbox).toHaveLength(0)
  })
})

describe('mergeSessionPages', () => {
  it('flattens cursor pages in order', () => {
    const first = session('first', 5)
    const second = session('second', 4)

    expect(mergeSessionPages([[first], [second]])).toEqual([first, second])
  })

  it('keeps the first copy when a session repeats across pages', () => {
    const newest = session('shared', 4)
    const older = session('older', 3)
    const repeated = session('shared', 2)

    expect(mergeSessionPages([[newest, older], [repeated]])).toEqual([newest, older])
  })

  it('returns an empty list when there are no pages', () => {
    expect(mergeSessionPages([])).toEqual([])
  })
})
