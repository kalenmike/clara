import type { SessionInfo } from '@opencode/client'
import { useModels } from '@/features/catalog/use-catalog'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import {
  estimateSessionCost,
  latestAssistantModel,
  latestContextTokens,
  resolveDisplayCost,
  type DisplayCost,
} from '@/features/cost/estimate'
import { useCostDisplay } from '@/features/cost/use-cost-display'

type SessionCostSnapshot = Pick<ChatSnapshot, 'cost' | 'tokens' | 'messages'>

/**
 * The session-level cost in the selected display mode. Estimated mode uses the
 * session total and the latest request's context size so tiered pricing does
 * not price the whole session as one huge request.
 */
export function useSessionCost(
  session: SessionInfo | undefined,
  snapshot: SessionCostSnapshot
): DisplayCost {
  const { source } = useCostDisplay()
  const modelsQuery = useModels()

  const actual = snapshot.cost || session?.cost
  const tokens = snapshot.tokens ?? session?.tokens
  const model = session?.model ?? latestAssistantModel(snapshot.messages)
  const estimated =
    source === 'estimated'
      ? estimateSessionCost(tokens, model, modelsQuery.data, {
          tierContextTokens: latestContextTokens(snapshot.messages) ?? 0,
        })
      : undefined

  return resolveDisplayCost(actual, estimated, source)
}
