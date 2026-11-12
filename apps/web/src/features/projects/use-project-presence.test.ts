import { describe, expect, it } from 'vitest'
import { combineProjectPresence } from './use-project-presence'

function result(
  data: boolean | undefined,
  options: { isError?: boolean; isPending?: boolean } = {}
) {
  return { data, isError: options.isError ?? false, isPending: options.isPending ?? false }
}

describe('combineProjectPresence', () => {
  it('maps each project to its session answer', () => {
    const presence = combineProjectPresence(['a', 'b'], [result(true), result(false)])

    expect(presence.hasSessions).toEqual(
      new Map([
        ['a', true],
        ['b', false],
      ])
    )
    expect(presence.pending).toBe(false)
    expect(presence.failed).toBe(false)
  })

  it('reports failures instead of treating them as empty projects', () => {
    const presence = combineProjectPresence(
      ['a', 'b'],
      [result(true), result(undefined, { isError: true })]
    )

    expect(presence.hasSessions).toEqual(new Map([['a', true]]))
    expect(presence.failed).toBe(true)
  })

  it('keeps pending lookups out of the answered map', () => {
    const presence = combineProjectPresence(['a'], [result(undefined, { isPending: true })])

    expect(presence.hasSessions.size).toBe(0)
    expect(presence.pending).toBe(true)
    expect(presence.failed).toBe(false)
  })
})
