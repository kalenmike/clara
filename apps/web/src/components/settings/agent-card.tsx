import { Bot, Check, CircleAlert, History } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'

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

  const chooseFixed = () => {
    if (settings.agent) {
      update({ mode: 'fixed' })
      return
    }
    const next =
      (lastAgent && agents.some((agent) => agent.id === lastAgent) ? lastAgent : undefined) ??
      agents.find((agent) => agent.id === 'build')?.id ??
      agents[0]?.id ??
      null
    update({ mode: 'fixed', agent: next })
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
        <div className="space-y-2">
          <div className="text-xs font-medium">New message drafts</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update({ mode: 'last' })}
              aria-pressed={!fixed}
              className={cn(!fixed && 'border-foreground/40 bg-accent')}
            >
              <History className="size-4" /> Last used
              {!fixed && <Check className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={chooseFixed}
              aria-pressed={fixed}
              className={cn(fixed && 'border-foreground/40 bg-accent')}
            >
              <Bot className="size-4" /> Specific agent
              {fixed && <Check className="size-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Last used: <span className="text-foreground">{lastUsedLabel}</span>
          </p>
        </div>

        {fixed && (
          <div className="space-y-1.5">
            <Label htmlFor="default-agent">Agent</Label>
            <Select
              value={settings.agent ?? undefined}
              onValueChange={(value) => update({ agent: value })}
            >
              <SelectTrigger
                id="default-agent"
                className="w-full sm:w-72"
                aria-label="Default agent"
              >
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <span className="truncate">{agent.name}</span>
                    <span className="text-[10px] text-muted-foreground">{agent.id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agentsQuery.isSuccess && agents.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No agents available.</p>
            )}
            {unavailable && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-mono">{settings.agent}</span> is not available. New drafts
                  use the last used agent until you choose another.
                </span>
              </p>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Applies when Clara creates a new message draft. Sessions that already have messages keep
          their agent.
        </p>
      </CardContent>
    </Card>
  )
}
