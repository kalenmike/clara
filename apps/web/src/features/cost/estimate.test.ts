import { describe, expect, it } from 'vitest'
import type { ModelCost, ModelInfo, SessionMessageInfo, TokenUsageInfo } from '@opencode/client'
import {
  estimateSessionCost,
  estimateStepCost,
  estimateUsageCost,
  findModel,
  latestContextTokens,
  resolveDisplayCost,
  selectCostTier,
  tokensContextTokens,
} from './estimate'

const BASE: ModelCost = {
  input: 3,
  output: 15,
  cache: { read: 0.3, write: 3.75 },
}

const TIERED: ModelCost[] = [
  { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
  { input: 2, output: 4, cache: { read: 0.2, write: 0.4 }, tier: { type: 'context', size: 200_000 } },
  { input: 3, output: 6, cache: { read: 0.3, write: 0.6 }, tier: { type: 'context', size: 400_000 } },
]

function model(cost: ModelCost[], overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'provider/model',
    modelID: 'model',
    providerID: 'provider',
    name: 'Model',
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [],
    time: { released: 0 },
    cost,
    status: 'active',
    enabled: true,
    limit: { context: 200_000, output: 64_000 },
    ...overrides,
  }
}

function tokens(overrides: Partial<TokenUsageInfo> = {}): TokenUsageInfo {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
    ...overrides,
  }
}

function assistant(
  id: string,
  usage: TokenUsageInfo | undefined
): SessionMessageInfo {
  return {
    id,
    type: 'assistant',
    time: { created: 1 },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content: [],
    tokens: usage,
  }
}

describe('tokensContextTokens', () => {
  it('sums uncached input and both cache buckets', () => {
    expect(
      tokensContextTokens(tokens({ input: 100, cache: { read: 20, write: 30 } }))
    ).toBe(150)
  })
})

describe('selectCostTier', () => {
  it('uses the base price below every tier', () => {
    expect(selectCostTier(TIERED, 199_999)).toBe(TIERED[0])
  })

  it('uses the highest tier that the context size exceeds', () => {
    expect(selectCostTier(TIERED, 450_000)).toBe(TIERED[2])
    expect(selectCostTier(TIERED, 250_000)).toBe(TIERED[1])
  })

  it('uses the lowest tier as the base when no untiered entry exists', () => {
    expect(selectCostTier(TIERED.slice(1), 0)).toBe(TIERED[1])
  })
})

describe('estimateUsageCost', () => {
  it('charges input, output, reasoning, and cache prices', () => {
    const cost = estimateUsageCost(
      tokens({
        input: 1_000,
        output: 200,
        reasoning: 50,
        cache: { read: 5_000, write: 1_000 },
      }),
      { cost: [BASE] }
    )

    // 1,000×3 + 200×15 + 50×15 + 5,000×0.3 + 1,000×3.75 = 0.012
    expect(cost).toBeCloseTo(0.012)
  })

  it('uses the request context size to choose a tier', () => {
    const usage = tokens({ input: 250_000 })

    expect(estimateUsageCost(usage, { cost: TIERED })).toBeCloseTo(0.5)
    expect(estimateUsageCost(usage, { cost: TIERED }, { tierContextTokens: 0 })).toBeCloseTo(0.25)
  })

  it('treats an empty cost list as free', () => {
    expect(estimateUsageCost(tokens({ input: 1_000 }), { cost: [] })).toBe(0)
  })

  it('returns no estimate without tokens or a model', () => {
    expect(estimateUsageCost(undefined, { cost: [BASE] })).toBeUndefined()
    expect(estimateUsageCost(tokens(), undefined)).toBeUndefined()
  })
})

describe('findModel', () => {
  it('matches both provider and model IDs', () => {
    const catalog = [
      model([BASE]),
      model([BASE], { id: 'other/model', modelID: 'model', providerID: 'other' }),
    ]

    expect(findModel(catalog, { id: 'model', providerID: 'provider' })).toBe(catalog[0])
    expect(findModel(catalog, { id: 'model', providerID: 'other' })).toBe(catalog[1])
    expect(findModel(catalog, { id: 'model', providerID: 'missing' })).toBeUndefined()
  })
})

describe('estimateStepCost', () => {
  it('uses the step model and tokens', () => {
    const step = {
      model: { id: 'model', providerID: 'provider' },
      tokens: tokens({ input: 1_000_000 }),
    }

    expect(estimateStepCost(step, [model([BASE])])).toBeCloseTo(3)
  })
})

describe('estimateSessionCost', () => {
  it('uses the supplied latest context size for tier selection', () => {
    const usage = tokens({ input: 100_000, output: 100_000 })

    expect(
      estimateSessionCost(usage, { id: 'model', providerID: 'provider' }, [model(TIERED)], {
        tierContextTokens: 250_000,
      })
    ).toBeCloseTo(0.6)
  })
})

describe('latestContextTokens', () => {
  it('finds the newest assistant step with usage', () => {
    const messages = [
      assistant('one', tokens({ input: 10 })),
      assistant('two', tokens({ input: 20, cache: { read: 5, write: 5 } })),
      assistant('three', undefined),
    ]

    expect(latestContextTokens(messages)).toBe(30)
  })

  it('returns undefined when no assistant usage exists', () => {
    expect(latestContextTokens([])).toBeUndefined()
    expect(latestContextTokens(undefined)).toBeUndefined()
  })
})

describe('resolveDisplayCost', () => {
  it('shows the estimate when it is available', () => {
    expect(resolveDisplayCost(1, 2, 'estimated')).toEqual({ value: 2, estimated: true })
  })

  it('keeps the actual cost in actual mode', () => {
    expect(resolveDisplayCost(1, 2, 'actual')).toEqual({ value: 1, estimated: false })
  })

  it('falls back to the actual cost when pricing is unknown', () => {
    expect(resolveDisplayCost(1, undefined, 'estimated')).toEqual({
      value: 1,
      estimated: false,
    })
  })
})
