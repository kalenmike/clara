export type SettledResult<T, R> =
  { item: T; status: 'fulfilled'; value: R } | { item: T; status: 'rejected'; reason: unknown }

/** Run async work with a fixed number of workers, collecting every result. */
export async function runWithConcurrencySettled<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<SettledResult<T, R>[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, Math.floor(concurrency) || 1)
  const results = new Array<SettledResult<T, R>>(items.length)
  let index = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      const item = items[current]
      index += 1
      if (item === undefined) continue

      try {
        results[current] = { item, status: 'fulfilled', value: await task(item) }
      } catch (reason) {
        results[current] = { item, status: 'rejected', reason }
      }
    }
  })

  await Promise.all(workers)
  return results
}

/** Run async work with a fixed number of workers. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      if (item !== undefined) await task(item)
    }
  })
  await Promise.all(workers)
}
