import type {
  ClaraModelCost,
  ClaraModel,
  ClaraSessionMessageAssistant,
  ClaraSessionMessage,
  ClaraTokenUsage,
} from '@clara/api-contract'

export type ModelRefLike = { id: string; providerID: string }

export type CostDisplaySource = 'actual' | 'estimated'

export type DisplayCost = {
  value: number | undefined
  estimated: boolean
}

const PER_MILLION_TOKENS = 1_000_000

export function findModel(
  models: readonly ClaraModel[] | undefined,
  model: ModelRefLike | undefined
): ClaraModel | undefined {
  if (!models || !model) return undefined
  return models.find((item) => item.modelID === model.id && item.providerID === model.providerID)
}

/** The context size the harness uses to choose a pricing tier. */
export function tokensContextTokens(tokens: ClaraTokenUsage | undefined): number | undefined {
  if (!tokens) return undefined
  return tokens.input + tokens.cache.read + tokens.cache.write
}

/**
 * Pick the price entry for one request. The harness applies the highest context
 * tier whose size is strictly exceeded and falls back to the base entry below
 * every tier. Entries without a tier are base prices.
 */
export function selectCostTier(
  costs: readonly ClaraModelCost[] | undefined,
  contextTokens: number
): ClaraModelCost | undefined {
  if (!costs || costs.length === 0) return undefined

  const tiered = costs
    .filter((cost) => cost.tier?.type === 'context' && contextTokens > cost.tier.size)
    .sort((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))

  return (
    tiered[0] ??
    costs.find((cost) => !cost.tier) ??
    [...costs].sort((a, b) => (a.tier?.size ?? 0) - (b.tier?.size ?? 0))[0]
  )
}

/**
 * Recreate the harness's calculated cost from token counts and a model's prices.
 * Reasoning tokens are charged at the output rate. Callers that estimate a
 * whole session can pass the latest request's context size so tiered pricing
 * does not treat the session total as one huge request.
 */
export function estimateUsageCost(
  tokens: ClaraTokenUsage | undefined,
  model: Pick<ClaraModel, 'cost'> | undefined,
  options: { tierContextTokens?: number } = {}
): number | undefined {
  if (!tokens || !model) return undefined
  if (model.cost.length === 0) return 0

  const contextTokens = options.tierContextTokens ?? tokensContextTokens(tokens) ?? 0
  const cost = selectCostTier(model.cost, contextTokens)
  if (!cost) return 0

  const value =
    tokens.input * cost.input +
    tokens.output * cost.output +
    tokens.reasoning * cost.output +
    tokens.cache.read * (cost.cache?.read ?? 0) +
    tokens.cache.write * (cost.cache?.write ?? 0)

  return Number.isFinite(value) ? Math.max(0, value) / PER_MILLION_TOKENS : undefined
}

/** Estimate one assistant step from its own tokens and model. */
export function estimateStepCost(
  step: Pick<ClaraSessionMessageAssistant, 'tokens' | 'model'>,
  models: readonly ClaraModel[] | undefined
): number | undefined {
  return estimateUsageCost(step.tokens, findModel(models, step.model))
}

/** Estimate a session from its aggregate tokens and current model. */
export function estimateSessionCost(
  tokens: ClaraTokenUsage | undefined,
  model: ModelRefLike | undefined,
  models: readonly ClaraModel[] | undefined,
  options: { tierContextTokens?: number } = {}
): number | undefined {
  return estimateUsageCost(tokens, findModel(models, model), options)
}

/** The latest request's context size, used to choose a session price tier. */
export function latestContextTokens(
  messages: readonly ClaraSessionMessage[] | undefined
): number | undefined {
  if (!messages) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === 'assistant' && message.tokens) return tokensContextTokens(message.tokens)
  }
  return undefined
}

/** The model on the newest assistant step, used when the session has no model. */
export function latestAssistantModel(
  messages: readonly ClaraSessionMessage[] | undefined
): ModelRefLike | undefined {
  if (!messages) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === 'assistant' && message.model?.id) return message.model
  }
  return undefined
}

/**
 * Choose the value to display. Estimated mode falls back to the reported cost
 * when the catalog has no price for the model, so a number is never hidden.
 */
export function resolveDisplayCost(
  actual: number | undefined,
  estimated: number | undefined,
  source: CostDisplaySource
): DisplayCost {
  if (source === 'estimated' && estimated !== undefined) {
    return { value: estimated, estimated: true }
  }
  return { value: actual, estimated: false }
}
