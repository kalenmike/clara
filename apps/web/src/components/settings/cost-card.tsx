import { Check, Coins } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCostDisplay } from '@/features/cost/use-cost-display'
import { cn } from '@/lib/utils'

const SOURCES = [
  {
    value: 'actual',
    label: 'Actual',
    description: 'The cost the harness reports for the session.',
  },
  {
    value: 'estimated',
    label: 'Estimated',
    description: 'Tokens multiplied by the model catalog prices.',
  },
] as const

export function CostCard() {
  const { source, setSource } = useCostDisplay()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="size-4" /> Cost display
        </CardTitle>
        <CardDescription>
          Choose whether Clara shows the harness-reported cost or an estimate calculated from model
          prices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map((option) => {
            const selected = source === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSource(option.value)}
                aria-pressed={selected}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  selected
                    ? 'border-foreground/40 bg-accent'
                    : 'border-border bg-background hover:bg-muted'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                {selected && <Check className="mt-0.5 size-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Estimated values are marked with <span className="font-mono">~</span>. They use the model
          catalog on this server and are not your remaining Go allowance. A session that switched
          models is estimated with its current model.
        </p>
      </CardContent>
    </Card>
  )
}
