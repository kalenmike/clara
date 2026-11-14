import { Bot, Check } from 'lucide-react'
import type { ClaraSession } from '@clara/api-contract'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAgents } from '@/features/catalog/use-catalog'
import { primaryAgents, subagents } from '@/features/agents/default-agent'
import { useSwitchAgent } from '@/features/chat/use-chat'

export function AgentPicker({
  session,
  harnessID,
  open,
  onOpenChange,
}: {
  session: ClaraSession | undefined
  /** The session's harness, so the picker lists that harness's agents. */
  harnessID?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const agentsQuery = useAgents(harnessID)
  const switchAgent = useSwitchAgent(session?.id ?? '')
  const agents = agentsQuery.data ?? []
  const primary = primaryAgents(agents)
  const delegated = subagents(agents)
  const loaded = agentsQuery.isSuccess

  // A harness with no agents (Pi) or only model-invoked subagents (Claude) has
  // nothing to switch between, so the control is not shown at all.
  if (loaded && primary.length === 0 && delegated.length === 0) return null

  const label = session?.agent ?? (primary[0]?.id || 'Agents')

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-24 min-w-0 shrink gap-1.5 text-muted-foreground max-md:h-11 max-sm:w-11 max-sm:justify-center max-sm:gap-0 max-sm:px-0 sm:max-w-36"
        >
          <Bot className="size-3.5 max-md:size-4" />
          <span className="truncate text-xs text-foreground max-sm:sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64">
        {!loaded && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading agents…</div>
        )}
        {primary.length > 0 && (
          <>
            <DropdownMenuLabel>Agent</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {primary.map((agent) => (
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
          </>
        )}
        {loaded && delegated.length > 0 && (
          <>
            {primary.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>Subagents</DropdownMenuLabel>
            <div className="px-2 pb-1 text-[10px] text-muted-foreground">Invoked by the model</div>
            {delegated.map((agent) => (
              <DropdownMenuItem key={agent.id} disabled className="gap-2">
                <Bot className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs">{agent.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {agent.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
