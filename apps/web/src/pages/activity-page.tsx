import { useMemo } from 'react'
import { Activity, Loader2, RefreshCw } from 'lucide-react'
import type { ClaraActivityHarness, ClaraProject } from '@clara/api-contract'
import { RunningAgentSection } from '@/components/activity/running-agent-section'
import { PageShell } from '@/components/layout/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  groupRunningSessions,
  sumRunningUsage,
  type RunningTotals,
} from '@/features/activity/running-activity'
import { useRunningActivity } from '@/features/activity/use-running-activity'
import { useArchivedProjects, useProjects } from '@/features/projects/use-projects'
import { errorMessage } from '@/lib/errors'
import { formatCost, formatCount, formatRelativeTime, formatTokens } from '@/lib/format'

export function ActivityPage() {
  const runningQuery = useRunningActivity()
  const projectsQuery = useProjects()
  const archivedQuery = useArchivedProjects()

  const projectByID = useMemo(() => {
    const map = new Map<string, ClaraProject>()
    for (const project of [...(projectsQuery.data ?? []), ...(archivedQuery.data ?? [])]) {
      map.set(project.id, project)
    }
    return map
  }, [archivedQuery.data, projectsQuery.data])
  const projectIDs = useMemo(() => new Set(projectByID.keys()), [projectByID])

  const response = runningQuery.data
  const data = useMemo(() => response?.data ?? [], [response])
  const harnesses = useMemo(() => response?.harnesses ?? [], [response])
  const { groups, idle } = useMemo(() => groupRunningSessions(data, harnesses), [data, harnesses])
  const totals = useMemo(() => sumRunningUsage(data), [data])
  const pending = runningQuery.isLoading || projectsQuery.isLoading
  const initialError = runningQuery.isError && data.length === 0

  return (
    <PageShell
      title="Running agents"
      eyebrow={
        <>
          <Activity className="size-3.5" />
          <span>Activity</span>
        </>
      }
      description="Live sessions across every paired harness."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => runningQuery.refresh.mutate()}
          disabled={runningQuery.isFetching || runningQuery.refresh.isPending}
        >
          {runningQuery.isFetching || runningQuery.refresh.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </Button>
      }
    >
      {pending ? (
        <RunningActivitySkeleton />
      ) : initialError ? (
        <RunningActivityError
          message={errorMessage(runningQuery.error)}
          onRetry={() => void runningQuery.refetch()}
        />
      ) : (
        <>
          <Summary totals={totals} harnessCount={harnesses.length} />

          {runningQuery.isError && (
            <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
              Could not refresh running agents. Showing the last result.{' '}
              <button className="underline" onClick={() => void runningQuery.refetch()}>
                Retry
              </button>
            </div>
          )}

          {data.length === 0 ? (
            <RunningActivityEmpty paired={harnesses.length > 0} />
          ) : (
            <div className="space-y-7">
              {groups.map((group) => (
                <RunningAgentSection
                  key={group.harness.harnessID}
                  harness={group.harness}
                  sessions={group.sessions}
                  projectByID={projectByID}
                  projectIDs={projectIDs}
                />
              ))}
            </div>
          )}

          {idle.length > 0 && <IdleHarnesses harnesses={idle} />}

          {response && data.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Updated {formatRelativeTime(runningQuery.dataUpdatedAt)}
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}

function Summary({ totals, harnessCount }: { totals: RunningTotals; harnessCount: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Running" value={formatCount(totals.sessions)} />
      <Stat
        label="Harnesses"
        value={`${formatCount(totals.harnesses)} / ${formatCount(harnessCount)}`}
      />
      <Stat label="Tokens" value={formatTokens(totals.tokens)} />
      <Stat label="Reported spend" value={formatCost(totals.cost)} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm" className="gap-1 py-3">
      <CardContent className="px-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-mono text-lg leading-none">{value}</p>
      </CardContent>
    </Card>
  )
}

function IdleHarnesses({ harnesses }: { harnesses: ClaraActivityHarness[] }) {
  return (
    <section className="space-y-2" aria-label="Other harnesses">
      <h2 className="text-sm font-semibold tracking-tight">Other harnesses</h2>
      <div className="flex flex-wrap gap-1.5">
        {harnesses.map((harness) => (
          <Badge
            key={harness.harnessID}
            variant="outline"
            className="text-[10px]"
            title={harness.message}
          >
            {harness.label} · {harness.online ? (harness.ok ? 'idle' : 'unavailable') : 'offline'}
          </Badge>
        ))}
      </div>
    </section>
  )
}

function RunningActivitySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-56 w-full" />
        ))}
      </div>
    </div>
  )
}

function RunningActivityError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">Could not load running agents</p>
      <p className="mt-1 max-w-sm break-words text-xs text-muted-foreground">{message}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function RunningActivityEmpty({ paired }: { paired: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">
        {paired ? 'No agents are running right now' : 'No harnesses paired'}
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {paired
          ? 'Sessions appear here while an agent is working. This view refreshes every few seconds.'
          : 'Pair a harness in the hub panel before running agents can appear here.'}
      </p>
    </div>
  )
}
