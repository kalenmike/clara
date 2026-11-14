import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowUpRight, FolderGit2, Loader2, Plus, SearchX } from 'lucide-react'
import { PageShell } from '@/components/layout/page-shell'
import { ProjectInfoCard } from '@/components/projects/project-info-card'
import { ProjectSettingsCard } from '@/components/projects/project-settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useModels } from '@/features/catalog/use-catalog'
import { estimateSessionCost, resolveDisplayCost } from '@/features/cost/estimate'
import { useCostDisplay } from '@/features/cost/use-cost-display'
import { projectLabel } from '@/features/projects/project-list'
import { resolveProjectWorkspaceTarget } from '@/features/projects/project-workspaces'
import { useProject } from '@/features/projects/use-projects'
import { useActiveSessions, useSessions } from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
import { errorMessage } from '@/lib/errors'
import { formatCost, formatRelativeTime, formatTokens } from '@/lib/format'
import { readLastWorkspace } from '@/lib/storage'
import { cn } from '@/lib/utils'

export function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const projectQuery = useProject(projectId)
  const project = projectQuery.project
  const lastWorkspaceID = project ? readLastWorkspace(project.id) : null
  const workspaceTarget = useMemo(
    () => resolveProjectWorkspaceTarget(project, lastWorkspaceID),
    [lastWorkspaceID, project]
  )
  const workspace = workspaceTarget.workspace
  const sessionsQuery = useSessions(project?.id ?? null, '', Boolean(project?.workspaces.length))
  const activeQuery = useActiveSessions()
  const modelsQuery = useModels()
  const { source: costSource } = useCostDisplay()
  const { plural, lowerSingular, lowerPlural } = useSessionWording()

  const sessions = sessionsQuery.data?.data ?? []
  const latest = sessions[0]
  const { startSession, pending } = useStartSession({
    projectID: project?.id,
    workspace,
    agent: latest?.agent,
    model: latest?.model,
  })

  if (projectQuery.isLoading) {
    return (
      <Centered>
        <Loader2 className="size-4 animate-spin" /> Loading project…
      </Centered>
    )
  }

  if (!project) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-sm font-medium">Project not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It may have been removed from the server.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </Centered>
    )
  }

  return (
    <PageShell
      title={projectLabel(project)}
      eyebrow={
        <>
          <FolderGit2 className="size-3.5" />
          <span>Project</span>
        </>
      }
      description={`Project details and ${lowerPlural}.`}
      actions={
        <Button onClick={() => startSession()} disabled={!workspaceTarget.startable || pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          New {lowerSingular}
        </Button>
      }
    >
      <ProjectInfoCard project={project} />
      <ProjectSettingsCard project={project} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">{plural}</h2>
        </div>

        {sessionsQuery.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        )}

        {sessionsQuery.isError && sessions.length > 0 && (
          <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
            Could not refresh {lowerPlural}.{' '}
            <button className="underline" onClick={() => void sessionsQuery.refetch()}>
              Retry
            </button>
            <span className="mt-1 block break-words text-[10px] text-muted-foreground/70">
              {errorMessage(sessionsQuery.error)}
            </span>
          </div>
        )}

        {!sessionsQuery.isLoading && sessionsQuery.isError && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
            <SearchX className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Could not load {lowerPlural}</p>
            <p className="mt-1 max-w-sm break-words text-xs text-muted-foreground">
              {errorMessage(sessionsQuery.error)}
            </p>
            <Button
              onClick={() => void sessionsQuery.refetch()}
              className="mt-4"
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        )}

        {!sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
            <SearchX className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No {lowerPlural} yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Start a {lowerSingular} to chat with an agent in this project.
            </p>
            <Button
              onClick={() => startSession()}
              className="mt-4"
              size="sm"
              disabled={!workspaceTarget.startable || pending}
            >
              <Plus className="size-4" /> New {lowerSingular}
            </Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((session) => {
            const active = Boolean(activeQuery.data?.[session.id])
            const displayCost = resolveDisplayCost(
              session.cost,
              costSource === 'estimated'
                ? estimateSessionCost(session.tokens, session.model, modelsQuery.data, {
                    tierContextTokens: 0,
                  })
                : undefined,
              costSource
            )
            return (
              <Link key={session.id} to={`/p/${project.id}/s/${session.id}`} className="group">
                <Card className="h-full gap-3 py-4 transition-colors group-hover:border-foreground/25">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-start justify-between gap-2 text-sm">
                      <span className="line-clamp-2">
                        {session.title || `Untitled ${lowerSingular}`}
                      </span>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {session.agent ?? 'build'}
                      </Badge>
                      <Badge variant="outline" className="max-w-[14rem] truncate text-[10px]">
                        {session.model?.id ?? 'default model'}
                      </Badge>
                      {active && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                          running
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className={cn(active && 'text-emerald-500')}>
                        {formatTokens(session.tokens.input)} in ·{' '}
                        {formatTokens(session.tokens.output)} out
                      </span>
                      <span
                        title={displayCost.estimated ? 'Estimated from model prices' : undefined}
                      >
                        {formatCost(displayCost.value, { estimated: displayCost.estimated })}
                      </span>
                      <span>{formatRelativeTime(session.time.updated)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>
    </PageShell>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
