import { describe, expect, it } from 'vitest'
import { TimeoutError, withTimeout } from './async'

describe('withTimeout', () => {
  it('resolves a promise that settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok')
  })

  it('rejects with the step that stalled', async () => {
    const pending = new Promise<string>(() => undefined)

    await expect(withTimeout(pending, 5, 'camera')).rejects.toMatchObject({
      name: 'TimeoutError',
      label: 'camera',
    })
  })

  it('passes the original rejection through', async () => {
    const cause = new DOMException('denied', 'NotAllowedError')

    await expect(withTimeout(Promise.reject(cause), 1_000)).rejects.toBe(cause)
  })

  it('marks the failure as a TimeoutError', () => {
    expect(new TimeoutError('preview')).toBeInstanceOf(Error)
    expect(new TimeoutError('preview').message).toContain('preview')
  })
})
