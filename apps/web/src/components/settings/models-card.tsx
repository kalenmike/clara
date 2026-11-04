import { useMemo, useState } from 'react'
import { CircleAlert, Cpu, RotateCcw } from 'lucide-react'
import type { ModelInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ModelProviderRow } from '@/components/settings/model-provider-row'
import { useModels, useProviders } from '@/features/catalog/use-catalog'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import {
  filterModelsByPrice,
  isModelHidden as modelIsHidden,
  type PriceFilter,
} from '@/features/models/visibility'
import { cn } from '@/lib/utils'

const FILTERS: Array<{ value: PriceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
]

export function ModelsCard() {
  const modelsQuery = useModels()
  const providersQuery = useProviders()
  const { visibility, hiddenCount, isModelHidden, setModelHidden, setProviderHidden, unhideAll } =
    useModelVisibility()
  const [filter, setFilter] = useState<PriceFilter>('all')

  const enabledModels = useMemo(
    () => (modelsQuery.data ?? []).filter((model) => model.enabled),
    [modelsQuery.data]
  )
  const filteredModels = useMemo(
    () => filterModelsByPrice(enabledModels, filter),
    [enabledModels, filter]
  )
  const counts = useMemo(
    () => ({
      all: enabledModels.length,
      free: filterModelsByPrice(enabledModels, 'free').length,
      paid: filterModelsByPrice(enabledModels, 'paid').length,
    }),
    [enabledModels]
  )

  const groups = useMemo(() => {
    const providerNames = new Map(
      (providersQuery.data ?? []).map((provider) => [provider.id, provider.name])
    )
    const grouped = new Map<string, ModelInfo[]>()
    for (const model of filteredModels) {
      const list = grouped.get(model.providerID) ?? []
      list.push(model)
      grouped.set(model.providerID, list)
    }
    return [...grouped.entries()]
      .map(([id, models]) => ({
        id,
        name: providerNames.get(id) ?? id,
        models,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredModels, providersQuery.data])

  const visibleCount = enabledModels.filter(
    (model) => !modelIsHidden(visibility, model.providerID, model.modelID)
  ).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="size-4" /> Models
        </CardTitle>
        <CardDescription>
          Choose which providers and models appear in the composer. Choices apply to this device and
          sync with the Preferences category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex rounded-lg border p-1"
            role="group"
            aria-label="Filter models by price"
          >
            {FILTERS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={filter === option.value ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className="gap-1.5"
              >
                {option.label}
                <span className="text-[10px] text-muted-foreground">{counts[option.value]}</span>
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={unhideAll}
            disabled={hiddenCount === 0}
            className="ml-auto"
          >
            <RotateCcw className="size-3.5" />
            Unhide all
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {hiddenCount === 0
            ? `${visibleCount} models visible in the composer.`
            : `${visibleCount} of ${enabledModels.length} models visible in the composer.`}
        </p>

        {modelsQuery.isPending && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Loading models…
          </p>
        )}

        {modelsQuery.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>Could not load models.</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => void modelsQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {modelsQuery.isSuccess && groups.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {filter === 'all' ? 'No models are available.' : `No ${filter} models are available.`}
          </p>
        )}

        {groups.length > 0 && (
          <div className={cn('divide-y rounded-lg border')}>
            {groups.map((group) => (
              <ModelProviderRow
                key={group.id}
                providerID={group.id}
                providerName={group.name}
                models={group.models}
                providerHidden={visibility.providers.includes(group.id)}
                isModelHidden={isModelHidden}
                onProviderHiddenChange={setProviderHidden}
                onModelHiddenChange={setModelHidden}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
