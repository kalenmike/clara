import { describe, expect, it } from 'vitest'
import { totalUsage } from './usage'

describe('totalUsage', () => {
  it('is zero for a run with no steps', () => {
    expect(totalUsage([])).toEqual({ tokens: 0, calls: 0 })
  })

  it('sums tokens and tool calls across every step', () => {
    expect(
      totalUsage([
        { tokens: 1_200, tool_calls: 3 },
        { tokens: 800, tool_calls: 0 },
        { tokens: 0, tool_calls: 5 },
      ])
    ).toEqual({ tokens: 2_000, calls: 8 })
  })
})
