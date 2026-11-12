import { describe, expect, it, vi } from 'vitest'
import { probeHub } from './hub-probe'

describe('probeHub', () => {
  it('checks hub status instead of the harness endpoint', async () => {
    const status = vi.fn().mockResolvedValue({ server: { version: '0.1.0' } })
    const info = vi.fn()

    const result = await probeHub({ server: { status } }, 1_000)

    expect(result).toEqual({ server: { version: '0.1.0' } })
    expect(status).toHaveBeenCalledOnce()
    expect(info).not.toHaveBeenCalled()
  })
})
