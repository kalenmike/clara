import { describe, expect, it } from 'vitest'
import { runWithConcurrencySettled, type SettledResult } from './concurrency'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe('runWithConcurrencySettled', () => {
  it('preserves input order even when tasks finish out of order', async () => {
    const items = ['first', 'second', 'third', 'fourth', 'fifth']
    const results: SettledResult<string, string>[] = await runWithConcurrencySettled(
      items,
      2,
      async (item) => {
        const wait = item === 'first' ? 20 : item === 'second' ? 8 : 1
        await delay(wait)
        return item.toUpperCase()
      }
    )

    expect(results.map((result) => result.item)).toEqual(items)
    expect(results).toEqual([
      { item: 'first', status: 'fulfilled', value: 'FIRST' },
      { item: 'second', status: 'fulfilled', value: 'SECOND' },
      { item: 'third', status: 'fulfilled', value: 'THIRD' },
      { item: 'fourth', status: 'fulfilled', value: 'FOURTH' },
      { item: 'fifth', status: 'fulfilled', value: 'FIFTH' },
    ])
  })

  it('never runs more than the requested number of tasks at once', async () => {
    let active = 0
    let peak = 0

    await runWithConcurrencySettled([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active += 1
      peak = Math.max(peak, active)
      await delay(2)
      active -= 1
    })

    expect(peak).toBe(3)
  })

  it('collects fulfilled values and rejected reasons for each item', async () => {
    const failure = new Error('nope')
    const results = await runWithConcurrencySettled([1, 2, 3], 2, async (item) => {
      await delay(1)
      if (item === 2) throw failure
      return item * 10
    })

    expect(results).toEqual([
      { item: 1, status: 'fulfilled', value: 10 },
      { item: 2, status: 'rejected', reason: failure },
      { item: 3, status: 'fulfilled', value: 30 },
    ])
  })

  it('returns an empty list without running any work', async () => {
    const task = async () => 'never'

    await expect(runWithConcurrencySettled([], 4, task)).resolves.toEqual([])
  })

  it('treats a non-positive concurrency as a single worker', async () => {
    let active = 0
    let peak = 0

    const results = await runWithConcurrencySettled([1, 2, 3], 0, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await delay(2)
      active -= 1
      return item
    })

    expect(peak).toBe(1)
    expect(results.map((result) => result.item)).toEqual([1, 2, 3])
  })
})
