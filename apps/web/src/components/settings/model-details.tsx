import type { ModelInfo } from '@opencode/client'
import { Badge } from '@/components/ui/badge'
import { formatTokens } from '@/lib/format'
import { formatPricePerMillion, isFreeModel } from '@/features/models/visibility'

type ReasoningCapability = {
  supported?: boolean
  effort?: string[]
}

type CapabilitiesWithReasoning = ModelInfo['capabilities'] & {
  reasoning?: ReasoningCapability
}

export function ModelDetails({ model }: { model: ModelInfo }) {
  const capabilities = model.capabilities as CapabilitiesWithReasoning
  const reasoning = capabilities.reasoning
  const free = isFreeModel(model)
  const input = capabilities.input.map(formatModality)
  const output = capabilities.output.map(formatModality)
  const variants = model.variants.map((variant) => variant.id)
  const context = model.limit.context
  const inputLimit = model.limit.input
  const outputLimit = model.limit.output

  return (
    <div className="space-y-1.5 pl-3 text-[10px] text-muted-foreground sm:pl-8">
      <div className="flex flex-wrap items-center gap-1">
        {capabilities.tools && <Badge variant="outline">tools</Badge>}
        {reasoning?.supported && <Badge variant="outline">reasoning</Badge>}
        {capabilities.temperature && <Badge variant="outline">temperature</Badge>}
        {input.length > 0 && <Badge variant="secondary">in: {input.join(', ')}</Badge>}
        {output.length > 0 && <Badge variant="secondary">out: {output.join(', ')}</Badge>}
        {free ? (
          <Badge variant="secondary">free</Badge>
        ) : (
          <Badge variant="secondary">paid</Badge>
        )}
        {model.status !== 'active' && <Badge variant="destructive">{model.status}</Badge>}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
        <span>context {formatTokens(context)}</span>
        {inputLimit && inputLimit !== context && <span>input {formatTokens(inputLimit)}</span>}
        <span>output {formatTokens(outputLimit)}</span>
        {model.family && <span>family {model.family}</span>}
        <span>released {formatReleaseDate(model.time.released)}</span>
        {variants.length > 0 && <span>variants {variants.join(', ')}</span>}
        {reasoning?.effort && reasoning.effort.length > 0 && (
          <span>effort {reasoning.effort.join(', ')}</span>
        )}
      </div>

      <div className="font-mono">
        {free ? (
          <span>No input, output, or cache cost</span>
        ) : (
          <div className="space-y-0.5">
            {model.cost.map((cost, index) => (
              <div key={`${cost.tier?.size ?? index}-${index}`}>
                {cost.tier && <span>≤{formatTokens(cost.tier.size)} context: </span>}
                {formatPricePerMillion(cost.input)} in · {formatPricePerMillion(cost.output)} out ·
                cache {formatPricePerMillion(cost.cache?.read)} read /{' '}
                {formatPricePerMillion(cost.cache?.write)} write
                <span className="text-muted-foreground/70"> per 1M tokens</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatModality(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatReleaseDate(timestamp: number): string {
  if (!timestamp) return 'unknown'
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
  })
}
