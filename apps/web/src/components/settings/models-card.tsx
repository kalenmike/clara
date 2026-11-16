import { useMemo, useState, useSyncExternalStore } from 'react'
import { CircleAlert, Cpu, Eye, EyeOff } from 'lucide-react'
import type { ClaraModel } from '@clara/api-contract'
import { harnessHostSummary } from '@clara/shared-types'
import { Badge } from '@clara/ui/components/badge'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import { ModelProviderRow } from '@/components/settings/model-provider-row'
import {
  useModelsForHarnessDetails,
  useProvidersForHarnessDetails,
} from '@/features/catalog/use-catalog'
import { ALL_HARNESSES, useCatalogHarness } from '@/features/settings/use-catalog-harness'
import {
  disableAllModels,
  enableAllModels,
  filterModelsByPrice,
  hiddenModelsFor,
  isModelHidden as modelIsHidden,
  providerDisplayName,
  readHiddenModels,
  saveHiddenModels,
  subscribeHiddenModels,
  withModelHidden,
  withProviderHidden,
  type PriceFilter,
} from '@/features/models/visibility'

const FILTERS: Array<{ value: PriceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
]

export function ModelsCard() {
  const catalog = useCatalogHarness()
  const harnessIDs = useMemo(
    () => catalog.targets.map((harness) => harness.harnessID),
    [catalog.targets]
  )
  const modelsByHarness = useModelsForHarnessDetails(harnessIDs)
  const providersByHarness = useProvidersForHarnessDetails(harnessIDs)
  const state = useSyncExternalStore(subscribeHiddenModels, readHiddenModels, readHiddenModels)
  const [filter, setFilter] = useState<PriceFilter>('all')

  const harnessSections = useMemo(
    () =>
      catalog.targets.map((harness) => {
        const modelsResult = modelsByHarness.get(harness.harnessID)
        const providersResult = providersByHarness.get(harness.harnessID)
        const visibility = hiddenModelsFor(state, harness.harnessID)
        const enabledModels = (modelsResult?.data ?? []).filter((model) => model.enabled)
        const filteredModels = filterModelsByPrice(enabledModels, filter)
        const providerNames = new Map(
          (providersResult?.data ?? []).map((provider) => [
            provider.id,
            providerDisplayName(provider.id, provider.name),
          ])
        )
        const grouped = new Map<string, ClaraModel[]>()
        for (const model of filteredModels) {
          const list = grouped.get(model.providerID) ?? []
          list.push(model)
          grouped.set(model.providerID, list)
        }
        const groups = [...grouped.entries()]
          .map(([id, models]) => ({
            id,
            name: providerNames.get(id) ?? id,
            models,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        const visibleCount = enabledModels.filter(
          (model) => !modelIsHidden(visibility, model.providerID, model.modelID)
        ).length
        const hiddenCount = visibility.providers.length + visibility.models.length
        const providerIDs = [...new Set(enabledModels.map((model) => model.providerID))]
        return {
          harness,
          modelsResult,
          visibility,
          enabledModels,
          groups,
          visibleCount,
          hiddenCount,
          providerIDs,
          counts: {
            all: enabledModels.length,
            free: filterModelsByPrice(enabledModels, 'free').length,
            paid: filterModelsByPrice(enabledModels, 'paid').length,
          },
        }
      }),
    [catalog.targets, filter, modelsByHarness, providersByHarness, state]
  )

  const totalVisible = harnessSections.reduce((sum, section) => sum + section.visibleCount, 0)
  const totalModels = harnessSections.reduce(
    (sum, section) => sum + section.enabledModels.length,
    0
  )

  const setProviderHidden = (harnessID: string, providerID: string, hidden: boolean) => {
    saveHiddenModels(withProviderHidden(readHiddenModels(), harnessID, providerID, hidden))
  }
  const setModelHidden = (
    harnessID: string,
    providerID: string,
    modelID: string,
    hidden: boolean
  ) => {
    saveHiddenModels(withModelHidden(readHiddenModels(), harnessID, providerID, modelID, hidden))
  }
  const enableAll = (harnessID: string) => {
    saveHiddenModels(enableAllModels(readHiddenModels(), harnessID))
  }
  const disableAll = (harnessID: string, providerIDs: string[]) => {
    saveHiddenModels(disableAllModels(readHiddenModels(), harnessID, providerIDs))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="size-4" /> Models
        </CardTitle>
        <CardDescription>
          Choose which providers and models appear in the composer. Choices apply per harness and
          sync with the Models category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={catalog.value} onValueChange={catalog.setValue}>
            <SelectTrigger className="w-full sm:w-64" aria-label="Catalog harness">
              <SelectValue placeholder="Choose a harness" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_HARNESSES}>All harnesses</SelectItem>
              {catalog.harnesses.map((harness) => {
                const host = harnessHostSummary(harness.host)
                return (
                  <SelectItem key={harness.harnessID} value={harness.harnessID}>
                    <span className="truncate">
                      {[harness.label, host].filter(Boolean).join(' · ')}
                    </span>
                    <Badge variant={harness.online ? 'secondary' : 'outline'} className="ml-2">
                      {harness.online ? 'Online' : 'Offline'}
                    </Badge>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <div
            className="flex rounded-lg border p-1"
            role="group"
            aria-label="Filter models by price"
          >
            {FILTERS.map((option) => {
              const counts = harnessSections.reduce(
                (sum, section) => sum + section.counts[option.value],
                0
              )
              return (
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
                  <span className="text-[10px] text-muted-foreground">{counts}</span>
                </Button>
              )
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {totalModels === 0
            ? 'No models are available for this selection.'
            : `${totalVisible} of ${totalModels} models visible in the composer.`}
        </p>

        {catalog.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>Could not load paired harnesses.</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => void catalog.refetch()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {catalog.pending && catalog.harnesses.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Loading harnesses…
          </p>
        )}

        {catalog.harnesses.length === 0 && !catalog.pending && !catalog.error && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            No harness is paired yet. Pair one in the hub panel.
          </p>
        )}

        {harnessSections.map((section) => {
          const { harness, modelsResult, groups } = section
          const allHidden = section.enabledModels.length > 0 && section.visibleCount === 0
          return (
            <section key={harness.harnessID} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{harness.label}</h3>
                <Badge variant={harness.online ? 'secondary' : 'outline'}>
                  {harness.online ? 'Online' : 'Offline'}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {section.visibleCount} of {section.enabledModels.length} visible
                </span>
                {section.hiddenCount > 0 && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="ml-auto h-auto p-0 text-xs"
                    onClick={() => enableAll(harness.harnessID)}
                  >
                    Show all
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={section.hiddenCount > 0 ? '' : 'ml-auto'}
                  onClick={() =>
                    allHidden
                      ? enableAll(harness.harnessID)
                      : disableAll(harness.harnessID, section.providerIDs)
                  }
                  disabled={section.providerIDs.length === 0}
                >
                  {allHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  {allHidden ? 'Enable all' : 'Disable all'}
                </Button>
              </div>

              {modelsResult?.isPending && (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Loading {harness.label} models…
                </p>
              )}

              {modelsResult?.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p>Could not load {harness.label} models.</p>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => modelsResult.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                </div>
              )}

              {modelsResult?.data && section.enabledModels.length === 0 && (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  {filter === 'all'
                    ? `No models are available from ${harness.label}.`
                    : `No ${filter} models are available from ${harness.label}.`}
                </p>
              )}

              {allHidden && (
                <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                  Every model from {harness.label} is hidden.{' '}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => enableAll(harness.harnessID)}
                  >
                    Show them again
                  </button>
                </p>
              )}

              {groups.length > 0 && (
                <div className="divide-y rounded-lg border">
                  {groups.map((group) => (
                    <ModelProviderRow
                      key={`${harness.harnessID}:${group.id}`}
                      providerID={group.id}
                      providerName={group.name}
                      models={group.models}
                      providerHidden={section.visibility.providers.includes(group.id)}
                      isModelHidden={(providerID, modelID) =>
                        modelIsHidden(section.visibility, providerID, modelID)
                      }
                      onProviderHiddenChange={(providerID, hidden) =>
                        setProviderHidden(harness.harnessID, providerID, hidden)
                      }
                      onModelHiddenChange={(providerID, modelID, hidden) =>
                        setModelHidden(harness.harnessID, providerID, modelID, hidden)
                      }
                    />
                  ))}
                </div>
              )}

              {modelsResult?.data && section.enabledModels.length > 0 && groups.length === 0 && (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No {filter} models are available from {harness.label}.
                </p>
              )}
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}
