import { Bot, CircleAlert, History } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents } from '@/features/catalog/use-catalog'

export function AgentCard() {
  const { settings, lastAgent, update } = useDefaultAgent()
  const agentsQuery = useAgents()
  const agents = (agentsQuery.data ?? []).filter(
    (agent) => !agent.hidden && agent.mode !== 'subagent'
  )

  const fixed = settings.mode === 'fixed'
  const fixedAvailable = agents.some((agent) => agent.id === settings.agent)
  const unavailable = fixed && settings.agent != null && agentsQuery.isSuccess && !fixedAvailable
  const lastUsed = agents.find((agent) => agent.id === lastAgent)
  const lastUsedLabel = lastUsed?.name ?? lastAgent ?? 'none yet'
  const value = fixed ? (settings.agent ?? undefined) : 'last'

  const choose = (next: string) => {
    if (next === 'last') update({ mode: 'last' })
    else update({ mode: 'fixed', agent: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4" /> Default agent
        </CardTitle>
        <CardDescription>
          Choose the agent a new message draft starts with. Existing messages keep the agent they
          already use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-agent">New message drafts</Label>
          <Select value={value} onValueChange={choose}>
            <SelectTrigger
              id="default-agent"
              className="w-full sm:w-72"
              aria-label="Default agent for new message drafts"
            >
              <SelectValue placeholder="Select an agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last">
                <History className="size-3.5 text-muted-foreground" />
                Last used
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <span className="truncate">{agent.name}</span>
                  <span className="text-[10px] text-muted-foreground">{agent.id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Last used: <span className="text-foreground">{lastUsedLabel}</span>
          </p>
          {agentsQuery.isSuccess && agents.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No agents available.</p>
          )}
          {unavailable && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-mono">{settings.agent}</span> is not available. New drafts use
                the last used agent until you choose another.
              </span>
            </p>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Applies when Clara creates a new message draft. Sessions that already have messages keep
          their agent.
        </p>
      </CardContent>
    </Card>
  )
}
