import { Check, Cpu, SlidersHorizontal } from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
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
  const currentModel = modelsQuery.data?.find(
    (model) =>
      model.modelID === session?.model?.id && model.providerID === session?.model?.providerID
  )

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onOpenChange(true)}
        title={currentModel ? `${currentModel.providerID}/${currentModel.modelID}` : undefined}
        className="max-w-40 min-w-0 shrink gap-1.5 sm:max-w-56"
      >
        <Cpu className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs">
          {currentModel?.name ?? session?.model?.id ?? 'default'}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Switch model</DialogTitle>
            <DialogDescription>
              {modelsQuery.data?.filter((model) => model.enabled).length ?? 0} enabled models
            </DialogDescription>
          </DialogHeader>
          <Command className="max-h-[60vh]">
            <CommandInput placeholder="Search models…" />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              {groupModels(modelsQuery.data ?? []).map((group) => (
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
  const switchModel = useSwitchModel(session?.id ?? '')
  const currentModel = modelsQuery.data?.find(
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
          className="h-7 max-w-24 min-w-0 shrink gap-1 text-[11px] text-muted-foreground sm:max-w-36"
        >
          <SlidersHorizontal className="size-3" />
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

function groupModels(
  models: Array<{ providerID: string; modelID: string; name: string; enabled: boolean }>
) {
  const enabled = models.filter((model) => model.enabled)
  const groups = new Map<string, typeof enabled>()
  for (const model of enabled) {
    const list = groups.get(model.providerID) ?? []
    list.push(model)
    groups.set(model.providerID, list)
  }
  return Array.from(groups.entries())
    .map(([provider, items]) => ({ provider, models: items }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}
