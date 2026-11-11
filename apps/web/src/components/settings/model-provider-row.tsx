import { useState } from 'react'
import { ChevronRight, Cpu } from 'lucide-react'
import type { ClaraModel } from '@clara/api-contract'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { ModelDetails } from '@/components/settings/model-details'
import { cn } from '@/lib/utils'

export function ModelProviderRow({
  providerID,
  providerName,
  models,
  providerHidden,
  isModelHidden,
  onProviderHiddenChange,
  onModelHiddenChange,
}: {
  providerID: string
  providerName: string
  models: ClaraModel[]
  providerHidden: boolean
  isModelHidden: (providerID: string, modelID: string) => boolean
  onProviderHiddenChange: (providerID: string, hidden: boolean) => void
  onModelHiddenChange: (providerID: string, modelID: string, hidden: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const hiddenCount = models.filter((model) => isModelHidden(providerID, model.modelID)).length

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${providerName}`}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90'
              )}
            />
            <span className="truncate text-xs font-medium">{providerName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {models.length} {models.length === 1 ? 'model' : 'models'}
            </span>
            {providerHidden ? (
              <Badge variant="outline">hidden</Badge>
            ) : hiddenCount > 0 ? (
              <Badge variant="secondary">{hiddenCount} hidden</Badge>
            ) : null}
          </button>
        </CollapsibleTrigger>
        <Switch
          checked={!providerHidden}
          onCheckedChange={(checked) => onProviderHiddenChange(providerID, !checked)}
          aria-label={`Show ${providerName} models`}
        />
      </div>

      <CollapsibleContent>
        <div className="border-t">
          {models.map((model) => {
            const hidden = isModelHidden(providerID, model.modelID)
            return (
              <div
                key={model.modelID}
                className={cn(
                  'space-y-1.5 border-b px-2 py-2.5 last:border-b-0',
                  hidden && 'opacity-60'
                )}
              >
                <div className="flex items-start gap-2">
                  <Cpu className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{model.name}</span>
                      {model.status !== 'active' && (
                        <Badge variant="outline" className="shrink-0">
                          {model.status}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {model.providerID}/{model.modelID}
                    </div>
                  </div>
                  <Switch
                    checked={!hidden}
                    disabled={providerHidden}
                    onCheckedChange={(checked) =>
                      onModelHiddenChange(providerID, model.modelID, !checked)
                    }
                    aria-label={`Show ${model.name}`}
                  />
                </div>
                <ModelDetails model={model} />
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
