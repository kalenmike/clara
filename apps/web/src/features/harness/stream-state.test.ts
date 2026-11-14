import { describe, expect, it } from 'vitest'
import { aggregateStreamState, onlineHarnessIDs } from './stream-state'

describe('aggregateStreamState', () => {
  it('is offline with no streams', () => {
    expect(aggregateStreamState([])).toBe('offline')
  })

  it('is live only when every stream is live', () => {
    expect(aggregateStreamState(['live', 'live'])).toBe('live')
  })

  it('reconnects when any stream drops', () => {
    expect(aggregateStreamState(['live', 'reconnecting'])).toBe('reconnecting')
    expect(aggregateStreamState(['live', 'offline'])).toBe('reconnecting')
    expect(aggregateStreamState(['reconnecting'])).toBe('reconnecting')
  })

  it('keeps connecting while every stream is still opening', () => {
    expect(aggregateStreamState(['connecting', 'connecting'])).toBe('connecting')
    expect(aggregateStreamState(['connecting', 'live'])).toBe('reconnecting')
  })

  it('is offline when every stream is offline', () => {
    expect(aggregateStreamState(['offline', 'offline'])).toBe('offline')
  })
})

describe('onlineHarnessIDs', () => {
  it('keeps online harnesses only, once each, in stable order', () => {
    expect(
      onlineHarnessIDs([
        { harnessID: 'b', online: true },
        { harnessID: 'a', online: false },
        { harnessID: 'b', online: true },
        { harnessID: 'c', online: true },
      ])
    ).toEqual(['b', 'c'])
  })

  it('returns nothing when every harness is offline', () => {
    expect(onlineHarnessIDs([{ harnessID: 'a', online: false }])).toEqual([])
  })
})
