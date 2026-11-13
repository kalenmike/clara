import { useMemo } from 'react'
import { Activity, Loader2, RefreshCw } from 'lucide-react'
import type { ClaraActivityHarness, ClaraProject } from '@clara/api-contract'
import { ActivityHarnessSection } from '@/components/activity/activity-harness-section'
import { PageShell } from '@/components/layout/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  groupActivitySessions,
  sumActivityUsage,
  type ActivityTotals,
} from '@/features/activity/activity-sessions'
import { useActivitySessions } from '@/features/activity/use-activity-sessions'
import { useArchivedProjects, useProjects } from '@/features/projects/use-projects'
import { errorMessage } from '@/lib/errors'
import { formatCost, formatCount, formatRelativeTime, formatTokens } from '@/lib/format'

export function ActivityPage() {
  const activityQuery = useActivitySessions()
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

  const response = activityQuery.data
  const data = useMemo(() => response?.data ?? [], [response])
  const harnesses = useMemo(() => response?.harnesses ?? [], [response])
  const { groups, idle } = useMemo(() => groupActivitySessions(data, harnesses), [data, harnesses])
  const totals = useMemo(() => sumActivityUsage(data), [data])
  const pending = activityQuery.isLoading || projectsQuery.isLoading
  const initialError = activityQuery.isError && data.length === 0

  return (
    <PageShell
      title="Activity"
      eyebrow={
        <>
          <Activity className="size-3.5" />
          <span>Agents</span>
        </>
      }
      description="Sessions in the Inbox or Outbox across every paired harness. Snoozed and archived sessions stay hidden."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => activityQuery.refresh.mutate()}
          disabled={activityQuery.isFetching || activityQuery.refresh.isPending}
        >
          {activityQuery.isFetching || activityQuery.refresh.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </Button>
      }
    >
      {pending ? (
        <ActivitySkeleton />
      ) : initialError ? (
        <ActivityError
          message={errorMessage(activityQuery.error)}
          onRetry={() => void activityQuery.refetch()}
        />
      ) : (
        <>
          <Summary totals={totals} harnessCount={harnesses.length} />

          {activityQuery.isError && (
            <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
              Could not refresh activity. Showing the last result.{' '}
              <button className="underline" onClick={() => void activityQuery.refetch()}>
                Retry
              </button>
            </div>
          )}

          {data.length === 0 ? (
            <ActivityEmpty paired={harnesses.length > 0} />
          ) : (
            <div className="space-y-7">
              {groups.map((group) => (
                <ActivityHarnessSection
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
              Updated {formatRelativeTime(activityQuery.dataUpdatedAt)}
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}

function Summary({ totals, harnessCount }: { totals: ActivityTotals; harnessCount: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Active" value={formatCount(totals.sessions)} />
      <Stat label="Inbox" value={formatCount(totals.inbox)} />
      <Stat label="Outbox" value={formatCount(totals.outbox)} />
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

function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
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

function ActivityError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">Could not load activity</p>
      <p className="mt-1 max-w-sm break-words text-xs text-muted-foreground">{message}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function ActivityEmpty({ paired }: { paired: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">
        {paired ? 'No sessions in the Inbox or Outbox' : 'No harnesses paired'}
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {paired
          ? 'Sessions appear here while an agent is working or waiting for your reply. Snoozed and archived sessions stay hidden.'
          : 'Pair a harness in the hub panel before activity can appear here.'}
      </p>
    </div>
  )
}
