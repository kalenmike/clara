import { useMemo } from 'react'
import { Check, Cpu, SlidersHorizontal } from 'lucide-react'
import type { ModelInfo, SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModels } from '@/features/catalog/use-catalog'
import { useSwitchModel } from '@/features/chat/use-chat'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { isModelVisible } from '@/features/models/visibility'

export function ModelPicker({
  session,
  open,
  onOpenChange,
}: {
  session: SessionInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const modelsQuery = useModels()
  const switchModel = useSwitchModel(session?.id ?? '')
  const { visibility, isModelHidden } = useModelVisibility()
  const models = useMemo(
    () => (modelsQuery.data ?? []).filter((model) => isModelVisible(model, visibility)),
    [modelsQuery.data, visibility]
  )
  const currentModel = models.find(
    (model) =>
      model.modelID === session?.model?.id && model.providerID === session?.model?.providerID
  )
  const storedModelHidden = Boolean(
    session?.model && isModelHidden(session.model.providerID, session.model.id)
  )

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onOpenChange(true)}
        title={currentModel ? `${currentModel.providerID}/${currentModel.modelID}` : undefined}
        className="max-w-40 min-w-0 shrink gap-1.5 max-md:h-11 max-md:px-3 max-md:text-sm sm:max-w-56"
      >
        <Cpu className="size-3.5 text-muted-foreground max-md:size-5" />
        <span className="truncate text-xs">
          {storedModelHidden ? 'No model' : (currentModel?.name ?? session?.model?.id ?? 'default')}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Switch model</DialogTitle>
            <DialogDescription>
              {storedModelHidden
                ? 'The current model is hidden. Pick a visible model to continue.'
                : `${models.length} visible ${models.length === 1 ? 'model' : 'models'}`}
            </DialogDescription>
          </DialogHeader>
          <Command className="max-h-[60vh]">
            <CommandInput placeholder="Search models…" />
            <CommandList>
              <CommandEmpty>
                {models.length === 0
                  ? 'No visible models. Enable one in Settings → Models.'
                  : 'No models found.'}
              </CommandEmpty>
              {groupModels(models).map((group) => (
                <CommandGroup key={group.provider} heading={group.provider}>
                  {group.models.map((model) => (
                    <CommandItem
                      key={`${model.providerID}/${model.modelID}`}
                      value={`${model.name} ${model.modelID} ${model.providerID}`}
                      onSelect={() => {
                        switchModel.mutate(
                          {
                            id: model.modelID,
                            providerID: model.providerID,
                          },
                          { onSuccess: () => onOpenChange(false) }
                        )
                      }}
                      className="gap-2"
                    >
                      <Cpu className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {model.providerID}/{model.modelID}
                      </span>
                      {model.modelID === session?.model?.id &&
                        model.providerID === session?.model?.providerID && (
                          <Check className="size-3.5" />
                        )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function VariantPicker({ session }: { session: SessionInfo | undefined }) {
  const modelsQuery = useModels()
  const { visibility } = useModelVisibility()
  const switchModel = useSwitchModel(session?.id ?? '')
  const currentModel = (modelsQuery.data ?? [])
    .filter((model) => isModelVisible(model, visibility))
    .find(
      (model) =>
        model.modelID === session?.model?.id && model.providerID === session?.model?.providerID
    )

  if (!currentModel || currentModel.variants.length === 0) return null

  const current = session?.model?.variant ?? 'default'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-24 min-w-0 shrink gap-1 text-[11px] text-muted-foreground max-md:h-11 max-md:px-3 max-md:text-sm sm:max-w-36"
        >
          <SlidersHorizontal className="size-3 max-md:size-5" />
          <span className="truncate">{current}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Variant</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {currentModel.variants.map((variant) => (
          <DropdownMenuItem
            key={variant.id}
            onSelect={() =>
              switchModel.mutate({
                id: currentModel.modelID,
                providerID: currentModel.providerID,
                variant: variant.id === 'default' ? undefined : variant.id,
              })
            }
          >
            {variant.id}
            {variant.id === current && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function groupModels(models: ModelInfo[]) {
  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const list = groups.get(model.providerID) ?? []
    list.push(model)
    groups.set(model.providerID, list)
  }
  return Array.from(groups.entries())
    .map(([provider, items]) => ({ provider, models: items }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}
