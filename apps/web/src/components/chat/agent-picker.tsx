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
  const primaryAgents = (agentsQuery.data ?? []).filter(
    (agent) => !agent.hidden && agent.mode !== 'subagent'
  )

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
          <span className="truncate text-xs text-foreground max-sm:sr-only">
            {session?.agent ?? 'build'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
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
  )
}
