import { describe, expect, it } from 'vitest'
import type { ClaraSessionsHarnessStatus } from '@clara/api-contract'
import {
  combineProjectPresence,
  type ProjectPresenceAnswer,
  type PresenceQueryResult,
} from './use-project-presence'

function harness(
  harnessID: string,
  options: { ok?: boolean; online?: boolean } = {}
): ClaraSessionsHarnessStatus {
  return {
    harnessID,
    label: harnessID,
    kind: 'opencode',
    online: options.online ?? true,
    ok: options.ok ?? true,
  }
}

function answer(
  hasSessions: boolean,
  harnesses: ReadonlyArray<ClaraSessionsHarnessStatus> = []
): ProjectPresenceAnswer {
  return { hasSessions, harnesses }
}

function result(
  data: ProjectPresenceAnswer | undefined,
  options: { isError?: boolean; isPending?: boolean } = {}
): PresenceQueryResult {
  return { data, isError: options.isError ?? false, isPending: options.isPending ?? false }
}

describe('combineProjectPresence', () => {
  it('maps each project to its session answer', () => {
    const presence = combineProjectPresence(
      ['a', 'b'],
      [result(answer(true)), result(answer(false))]
    )

    expect(presence.hasSessions).toEqual(
      new Map([
        ['a', true],
        ['b', false],
      ])
    )
    expect(presence.incomplete.size).toBe(0)
    expect(presence.pending).toBe(false)
    expect(presence.failed).toBe(false)
  })

  it('treats a partial answer as incomplete instead of failed or empty', () => {
    const presence = combineProjectPresence(
      ['a'],
      [result(answer(false, [harness('alpha'), harness('beta', { ok: false, online: false })]))]
    )

    expect(presence.hasSessions.get('a')).toBe(false)
    expect(presence.incomplete.has('a')).toBe(true)
    expect(presence.failed).toBe(false)
    expect(presence.pending).toBe(false)
  })

  it('keeps one answered lookup from failing the whole group', () => {
    const presence = combineProjectPresence(
      ['a', 'b'],
      [result(answer(true)), result(undefined, { isError: true })]
    )

    expect(presence.hasSessions).toEqual(new Map([['a', true]]))
    expect(presence.incomplete.size).toBe(0)
    expect(presence.failed).toBe(false)
  })

  it('reports failure only when no lookup answered at all', () => {
    const presence = combineProjectPresence(
      ['a', 'b'],
      [result(undefined, { isError: true }), result(undefined, { isError: true })]
    )

    expect(presence.hasSessions.size).toBe(0)
    expect(presence.failed).toBe(true)
  })

  it('keeps pending lookups out of the answered map', () => {
    const presence = combineProjectPresence(['a'], [result(undefined, { isPending: true })])

    expect(presence.hasSessions.size).toBe(0)
    expect(presence.pending).toBe(true)
    expect(presence.failed).toBe(false)
  })
})
