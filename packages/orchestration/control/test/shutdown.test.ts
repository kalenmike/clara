import { afterEach, describe, expect, it, vi } from 'vitest'
import { shutdownService } from '../src/shutdown.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function exitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('shutdownService', () => {
  it('runs the close path and exits cleanly', async () => {
    const exit = exitSpy()
    const close = vi.fn(async () => undefined)

    shutdownService({ label: 'test', close })
    await flush()

    expect(close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits even when close never settles', async () => {
    vi.useFakeTimers()
    const exit = exitSpy()
    const log = vi.fn()

    shutdownService({ label: 'test', timeoutMs: 25, close: () => new Promise(() => {}), log })
    await vi.advanceTimersByTimeAsync(30)

    expect(log).toHaveBeenCalledWith('test: shutdown did not finish in 25ms')
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits non-zero when the close path throws', async () => {
    const exit = exitSpy()
    const log = vi.fn()

    shutdownService({
      label: 'test',
      close: () => Promise.reject(new Error('close failed')),
      log,
    })
    await flush()

    expect(log).toHaveBeenCalledWith('test: shutdown failed', expect.any(Error))
    expect(exit).toHaveBeenCalledWith(1)
  })
})
