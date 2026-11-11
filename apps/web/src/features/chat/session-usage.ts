import type { ClaraTokenUsage } from '@clara/api-contract'
import type { DisplayCost } from '@/features/cost/estimate'
import { formatCost, formatTokens } from '@/lib/format'

/**
 * The compact whole-session line in the chat's bottom bar. It follows the
 * thinking footer's wording, but reads the server's session totals so lazy
 * history pages cannot leave it short.
 */
export function formatSessionUsage(
  tokens: ClaraTokenUsage | undefined,
  cost: DisplayCost,
  age: string
): string {
  const cache = (tokens?.cache.read ?? 0) + (tokens?.cache.write ?? 0)
  return [
    `${formatTokens(tokens?.input)} in`,
    `${formatTokens(tokens?.output)} out`,
    `${formatTokens(tokens?.reasoning)} reason`,
    `${formatTokens(cache)} cache`,
    formatCost(cost.value, { estimated: cost.estimated }),
    age,
  ].join(' · ')
}
