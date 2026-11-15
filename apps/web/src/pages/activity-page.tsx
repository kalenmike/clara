import { useMemo } from 'react'
import { Link } from 'react-router'
import { Activity, FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import type { ClaraActivityHarness, ClaraProject } from '@clara/api-contract'
import { ActivityHarnessSection } from '@/components/activity/activity-harness-section'
import { PageShell } from '@/components/layout/page-shell'
import { FullWindowShell } from '@/components/layout/full-window-shell'
import { Badge } from '@clara/ui/components/badge'
import { Button } from '@clara/ui/components/button'
import { Card, CardContent } from '@clara/ui/components/card'
import { Skeleton } from '@clara/ui/components/skeleton'
import {
  groupActivitySessions,
  sumActivityUsage,
  type ActivityTotals,
} from '@/features/activity/activity-sessions'
import { useActivitySessions } from '@/features/activity/use-activity-sessions'
import { projectLabel } from '@/features/projects/project-list'
import { findProject, useArchivedProjects, useProjects } from '@/features/projects/use-projects'
import { errorMessage } from '@/lib/errors'
import { formatCost, formatCount, formatRelativeTime, formatTokens } from '@/lib/format'
import { readLastProject } from '@/lib/storage'
import { ConnectedProviders } from '@/providers/connected-providers'

export function ActivityPage() {
  return (
    <FullWindowShell>
      <ConnectedProviders>
        <div className="min-h-0 flex-1">
          <ActivityScreen />
        </div>
      </ConnectedProviders>
    </FullWindowShell>
  )
}

function ActivityScreen() {
  const projectsQuery = useProjects()
  const archivedQuery = useArchivedProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const project = useMemo(
    () => findProject(projects, readLastProject()) ?? projects[0] ?? null,
    [projects]
  )
  const activityQuery = useActivitySessions(project?.id ?? null)

  const projectByID = useMemo(() => {
    const map = new Map<string, ClaraProject>()
    for (const item of [...(projectsQuery.data ?? []), ...(archivedQuery.data ?? [])]) {
      map.set(item.id, item)
    }
    return map
  }, [archivedQuery.data, projectsQuery.data])
  const projectIDs = useMemo(() => new Set(projectByID.keys()), [projectByID])

  const response = activityQuery.data
  const data = useMemo(() => response?.data ?? [], [response])
  const harnesses = useMemo(() => response?.harnesses ?? [], [response])
  const { groups, idle } = useMemo(() => groupActivitySessions(data, harnesses), [data, harnesses])
  const totals = useMemo(() => sumActivityUsage(data), [data])
  const pending = projectsQuery.isLoading || activityQuery.isLoading
  const initialError = activityQuery.isError && data.length === 0

  return (
    <PageShell
      title="Activity"
      eyebrow={
        <>
          <Activity className="size-3.5" />
          <span>Project</span>
        </>
      }
      description={
        project
          ? `Inbox and Outbox sessions across every workspace and harness in ${projectLabel(project)}. Snoozed and archived sessions stay hidden.`
          : 'Inbox and Outbox sessions for the active project.'
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => activityQuery.refresh.mutate()}
          disabled={!project || activityQuery.isFetching || activityQuery.refresh.isPending}
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
      ) : !project ? (
        <ActivityNoProject />
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
            <ActivityEmpty
              paired={harnesses.length > 0}
              hasWorkspaces={project.workspaces.length > 0}
              projectID={project.id}
            />
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

function ActivityNoProject() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <FolderGit2 className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">No project selected</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Open a project from Chat before checking its activity.
      </p>
      <Button asChild className="mt-4" size="sm" variant="outline">
        <Link to="/projects">Browse projects</Link>
      </Button>
    </div>
  )
}

function ActivityEmpty({
  paired,
  hasWorkspaces,
  projectID,
}: {
  paired: boolean
  hasWorkspaces: boolean
  projectID: string
}) {
  const title = !hasWorkspaces
    ? 'No workspaces in this project'
    : !paired
      ? 'No harnesses available'
      : 'No sessions in the Inbox or Outbox'
  const description = !hasWorkspaces
    ? 'Add a workspace on a paired harness before activity can appear here.'
    : !paired
      ? 'Pair a harness in the hub panel, or add this project on a harness that is connected.'
      : 'Sessions appear here while an agent in this project is working or waiting for your reply. Snoozed and archived sessions stay hidden.'

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      <Button asChild className="mt-4" size="sm" variant="outline">
        <Link to={`/p/${projectID}`}>Open project</Link>
      </Button>
    </div>
  )
}
