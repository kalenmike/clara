import { describe, expect, it } from 'vitest'
import { MAILBOX_SIGNAL_CONCURRENCY, withMailboxSignalSlot } from './session-mailbox-queue'

describe('withMailboxSignalSlot', () => {
  it('keeps active mailbox loads within the shared ceiling', async () => {
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: MAILBOX_SIGNAL_CONCURRENCY + 5 }, () =>
      withMailboxSignalSlot(async () => {
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
      })
    )

    await Promise.all(tasks)

    expect(peak).toBeLessThanOrEqual(MAILBOX_SIGNAL_CONCURRENCY)
    expect(active).toBe(0)
  })

  it('releases the slot when a lookup fails', async () => {
    await expect(
      withMailboxSignalSlot(() => Promise.reject(new Error('lookup failed')))
    ).rejects.toThrow('lookup failed')

    await expect(withMailboxSignalSlot(() => Promise.resolve('next'))).resolves.toBe('next')
  })
})
