import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  Archive,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Cpu,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
import { Badge } from '@/components/ui/badge'
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
  DialogFooter,
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
import { Input } from '@/components/ui/input'
import { useAgents, useModels } from '@/features/catalog/use-catalog'
import {
  useCompactSession,
  useInterruptSession,
  useSwitchAgent,
  useSwitchModel,
} from '@/features/chat/use-chat'
import {
  useArchiveSession,
  useDeleteSession,
  useRenameSession,
} from '@/features/sessions/use-sessions'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { formatCost, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ChatHeader({
  session,
  snapshot,
  projectID,
  infoOpen,
  onToggleInfo,
  onDeleted,
}: {
  session: SessionInfo | undefined
  snapshot: ChatSnapshot
  projectID: string
  infoOpen: boolean
  onToggleInfo: () => void
  onDeleted: () => void
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(session?.title ?? '')
  const agentsQuery = useAgents()
  const modelsQuery = useModels()
  const switchAgent = useSwitchAgent(session?.id ?? '')
  const switchModel = useSwitchModel(session?.id ?? '')
  const interrupt = useInterruptSession(session?.id ?? '')
  const compact = useCompactSession(session?.id ?? '')
  const rename = useRenameSession(session?.id ?? '')
  const archive = useArchiveSession(session?.id ?? '')
  const remove = useDeleteSession()

  const busy = snapshot.status.type !== 'idle'
  const currentModel = modelsQuery.data?.find(
    (model) =>
      model.modelID === session?.model?.id && model.providerID === session?.model?.providerID
  )
  const primaryAgents = (agentsQuery.data ?? []).filter(
    (agent) => !agent.hidden && agent.mode !== 'subagent'
  )

  useEffect(() => {
    const openModels = () => setModelOpen(true)
    const openAgents = () => setAgentOpen(true)
    window.addEventListener('clara:open-models', openModels)
    window.addEventListener('clara:open-agents', openAgents)
    return () => {
      window.removeEventListener('clara:open-models', openModels)
      window.removeEventListener('clara:open-agents', openAgents)
    }
  }, [])

  useEffect(() => {
    const cycle = () => {
      if (!currentModel || currentModel.variants.length < 2) return
      const current = session?.model?.variant ?? 'default'
      const index = currentModel.variants.findIndex((variant) => variant.id === current)
      const next = currentModel.variants[(index + 1) % currentModel.variants.length]
      switchModel.mutate({
        id: currentModel.modelID,
        providerID: currentModel.providerID,
        variant: next.id === 'default' ? undefined : next.id,
      })
    }
    window.addEventListener('clara:cycle-variant', cycle)
    return () => window.removeEventListener('clara:cycle-variant', cycle)
  }, [currentModel, session?.model?.variant, switchModel])

  const copyID = async () => {
    if (!session) return
    await navigator.clipboard.writeText(session.id)
  }

  const deleteSession = () => {
    if (!session) return
    if (!window.confirm('Delete this session and all of its messages?')) return
    remove.mutate(session.id, { onSuccess: onDeleted })
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b px-2 md:px-3">
      <Button asChild variant="ghost" size="icon" className="size-8 md:hidden">
        <Link to={`/p/${projectID}`}>
          <ArrowLeft className="size-4" />
          <span className="sr-only">Back to sessions</span>
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => {
            setTitle(session?.title ?? '')
            setRenameOpen(true)
          }}
          className="flex min-w-0 items-center gap-1 text-left"
        >
          <span className="truncate text-sm font-medium">
            {session?.title || 'Untitled session'}
          </span>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:opacity-100 md:opacity-0" />
        </button>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className={cn(busy && 'text-emerald-500')}>{statusLabel(snapshot)}</span>
          <span>· {formatCost(snapshot.cost || session?.cost)}</span>
          <span className="hidden sm:inline">
            · {formatTokens((snapshot.tokens ?? session?.tokens)?.input)} in /{' '}
            {formatTokens((snapshot.tokens ?? session?.tokens)?.output)} out
          </span>
        </div>
      </div>

      <DropdownMenu open={agentOpen} onOpenChange={setAgentOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="hidden max-w-36 gap-1.5 sm:flex">
            <Bot className="size-3.5 text-muted-foreground" />
            <span className="truncate text-xs">{session?.agent ?? 'build'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {primaryAgents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => switchAgent.mutate(agent.id)}
              className="gap-2"
            >
              <Bot className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs">{agent.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {agent.description}
                </span>
              </span>
              {agent.id === session?.agent && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          {primaryAgents.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No agents available</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setModelOpen(true)}
        className="max-w-44 gap-1.5"
      >
        <Cpu className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs">{session?.model?.id ?? 'default'}</span>
        {session?.model?.variant && session.model.variant !== 'default' && (
          <Badge variant="outline" className="text-[9px]">
            {session.model.variant}
          </Badge>
        )}
      </Button>

      {currentModel && currentModel.variants.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="hidden text-xs lg:flex">
              variant
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
                {variant.id === (session?.model?.variant ?? 'default') && (
                  <Check className="ml-auto size-3.5" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {busy && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => interrupt.mutate()}
          disabled={interrupt.isPending}
          className="gap-1.5"
        >
          <Square className="size-3.5" />
          <span className="hidden sm:inline">Stop</span>
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleInfo}
        className={cn('size-8', infoOpen && 'bg-accent')}
      >
        <PanelRight className="size-4" />
        <span className="sr-only">Toggle session info</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={copyID}>
            <Copy className="size-3.5" /> Copy session ID
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => compact.mutate()}>
            <PanelRight className="size-3.5" /> Compact context
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => archive.mutate(true)}>
            <Archive className="size-3.5" /> Archive session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteSession} className="text-destructive">
            <Trash2 className="size-3.5" /> Delete session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={modelOpen} onOpenChange={setModelOpen}>
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
                          { onSuccess: () => setModelOpen(false) }
                        )
                      }}
                      className="gap-2"
                    >
                      <Cpu className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {model.modelID}
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

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>Give this session a short, searchable title.</DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => rename.mutate(title.trim(), { onSuccess: () => setRenameOpen(false) })}
              disabled={!title.trim() || rename.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
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

function statusLabel(snapshot: ChatSnapshot): string {
  if (snapshot.status.type === 'busy') return 'running'
  if (snapshot.status.type === 'retry') return `retry ${snapshot.status.attempt}`
  return 'idle'
}
