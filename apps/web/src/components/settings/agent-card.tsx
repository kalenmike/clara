import { useMemo } from 'react'
import { Bot, CircleAlert, History } from 'lucide-react'
import type { ClaraAgent } from '@clara/api-contract'
import { Badge } from '@clara/ui/components/badge'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import { Label } from '@clara/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { primaryAgents } from '@/features/agents/default-agent'
import { useAgentsForHarnessDetails } from '@/features/catalog/use-catalog'
import { useCatalogHarness } from '@/features/settings/use-catalog-harness'
import type { ClaraHarnessConnection } from '@clara/api-contract'

function HarnessAgentGroup({
  harness,
  agents,
  pending,
  error,
  refetch,
}: {
  harness: ClaraHarnessConnection
  agents: readonly ClaraAgent[]
  pending: boolean
  error: boolean
  refetch: () => void
}) {
  const { settings, lastAgent, update } = useDefaultAgent(harness.harnessID)
  const primary = useMemo(() => primaryAgents(agents), [agents])
  const fixed = settings.mode === 'fixed'
  const fixedAvailable = primary.some((agent) => agent.id === settings.agent)
  const unavailable = fixed && settings.agent != null && !pending && !error && !fixedAvailable
  const lastUsed = primary.find((agent) => agent.id === lastAgent)
  const lastUsedLabel = lastUsed?.name ?? lastAgent ?? 'none yet'
  const value = fixed ? (settings.agent ?? undefined) : 'last'

  const choose = (next: string) => {
    if (next === 'last') update({ mode: 'last' })
    else update({ mode: 'fixed', agent: next })
  }

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{harness.label}</h3>
        <Badge variant={harness.online ? 'secondary' : 'outline'}>
          {harness.online ? 'Online' : 'Offline'}
        </Badge>
      </div>

      {pending && <p className="text-[11px] text-muted-foreground">Loading agents…</p>}

      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>Could not load {harness.label} agents.</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={refetch}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`default-agent-${harness.harnessID}`}>New message drafts</Label>
        <Select value={value} onValueChange={choose}>
          <SelectTrigger
            id={`default-agent-${harness.harnessID}`}
            className="w-full sm:w-72"
            aria-label={`Default agent for ${harness.label}`}
          >
            <SelectValue placeholder="Select an agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last">
              <History className="size-3.5 text-muted-foreground" />
              Last used
            </SelectItem>
            {primary.map((agent) => (
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
        {!pending && !error && primary.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No agents available from {harness.label}.
          </p>
        )}
        {unavailable && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-mono">{settings.agent}</span> is not available from{' '}
              {harness.label}. New drafts use the last used agent until you choose another.
            </span>
          </p>
        )}
      </div>
    </section>
  )
}

export function AgentCard() {
  const catalog = useCatalogHarness()
  const harnessIDs = useMemo(
    () => catalog.targets.map((harness) => harness.harnessID),
    [catalog.targets]
  )
  const agentsByHarness = useAgentsForHarnessDetails(harnessIDs)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4" /> Default agent
        </CardTitle>
        <CardDescription>
          Choose the agent a new message draft starts with on each harness. Existing messages keep
          the agent they already use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {catalog.targets.map((harness) => {
          const result = agentsByHarness.get(harness.harnessID)
          return (
            <HarnessAgentGroup
              key={harness.harnessID}
              harness={harness}
              agents={result?.data ?? []}
              pending={result?.isPending ?? true}
              error={result?.isError ?? false}
              refetch={() => result?.refetch()}
            />
          )
        })}

        <p className="text-[11px] text-muted-foreground">
          Applies when Clara creates a new message draft. Sessions that already have messages keep
          their agent.
        </p>
      </CardContent>
    </Card>
  )
}
