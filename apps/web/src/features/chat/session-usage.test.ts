import { describe, expect, it } from 'vitest'
import type { ClaraTokenUsage } from '@clara/api-contract'
import { formatSessionUsage } from './session-usage'

function tokens(overrides: Partial<ClaraTokenUsage> = {}): ClaraTokenUsage {
  return {
    input: 32_000,
    output: 10_100,
    reasoning: 15_000,
    cache: { read: 3_000, write: 2_000 },
    ...overrides,
  }
}

describe('formatSessionUsage', () => {
  it('shows session tokens, cost, and age in the thinking-footer order', () => {
    expect(
      formatSessionUsage(tokens(), { value: 0.028, estimated: false }, 'started 7 days ago')
    ).toBe('32K in · 10.1K out · 15K reason · 5K cache · $0.028 · started 7 days ago')
  })

  it('sums cache reads and writes into one cache total', () => {
    const text = formatSessionUsage(
      tokens({ cache: { read: 1_200, write: 300 } }),
      { value: 0.01, estimated: false },
      'started just now'
    )

    expect(text).toContain('1.5K cache')
  })

  it('marks an estimated cost with a tilde', () => {
    const text = formatSessionUsage(
      tokens(),
      { value: 0.028, estimated: true },
      'started 2 hours ago'
    )

    expect(text).toContain('~$0.028')
  })

  it('shows a zeroed line before the first turn', () => {
    expect(
      formatSessionUsage(
        {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        { value: undefined, estimated: false },
        'started just now'
      )
    ).toBe('0 in · 0 out · 0 reason · 0 cache · $0.00 · started just now')
  })
})
