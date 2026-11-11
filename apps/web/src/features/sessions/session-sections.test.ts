import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { isAutomationSession } from './session-automation'
import { groupSessionsByMailbox } from './session-sections'

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
  it('keeps automation sessions out of every mailbox group', () => {
    const active = session('worker-active', 4, { automation: true })
    const archived = session('worker-archived', 3, { automation: true }, 300)
    const snoozed = session('worker-snoozed', 2, { automation: true, snoozed: true })
    const human = session('human', 1, {})

    const groups = groupSessionsByMailbox(
      [active, archived, snoozed, human],
      signals,
      running,
      awaitingInput,
      isAutomationSession
    )

    expect(groups.workers.map((item) => item.id)).toEqual([
      'worker-active',
      'worker-archived',
      'worker-snoozed',
    ])
    expect(groups.inbox.map((item) => item.id)).toEqual(['human'])
    expect(groups.archived).toHaveLength(0)
    expect(groups.snoozed).toHaveLength(0)
  })

  it('leaves automation sessions in normal groups when the predicate is absent', () => {
    const archived = session('worker-archived', 3, { automation: true }, 300)

    const groups = groupSessionsByMailbox([archived], signals, running, awaitingInput)

    expect(groups.workers).toHaveLength(0)
    expect(groups.archived.map((item) => item.id)).toEqual(['worker-archived'])
  })
})
