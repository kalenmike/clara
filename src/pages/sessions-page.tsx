import { Link, useNavigate, useParams } from 'react-router'
import { ArrowUpRight, FolderGit2, Loader2, Plus, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/features/projects/use-projects'
import { useActiveSessions, useCreateSession, useSessions } from '@/features/sessions/use-sessions'
import { formatCost, formatRelativeTime, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const projectsQuery = useProjects()
  const project = projectsQuery.data?.find((item) => item.id === projectId)
  const sessionsQuery = useSessions(project?.canonical ?? null, '')
  const activeQuery = useActiveSessions()
  const createSession = useCreateSession(project?.canonical ?? '')

  const sessions = sessionsQuery.data?.data ?? []

  if (projectsQuery.isLoading) {
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
            It may have been removed from OpenCode.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </Centered>
    )
  }

  const startSession = () => {
    const latest = sessions[0]
    createSession.mutate(
      { agent: latest?.agent, model: latest?.model },
      {
        onSuccess: (session) => navigate(`/p/${project.id}/s/${session.id}`),
      }
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderGit2 className="size-3.5" />
              <span className="truncate font-mono">{project.canonical}</span>
            </div>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">
              {project.name ?? project.canonical.split('/').pop()}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {sessions.length} session{sessions.length === 1 ? '' : 's'} in this project
            </p>
          </div>
          <Button onClick={startSession} disabled={createSession.isPending}>
            {createSession.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New session
          </Button>
        </div>

        {sessionsQuery.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        )}

        {!sessionsQuery.isLoading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
            <SearchX className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No sessions yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Start a session to chat with an agent in this project.
            </p>
            <Button onClick={startSession} className="mt-4" size="sm">
              <Plus className="size-4" /> New session
            </Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((session) => {
            const active = Boolean(activeQuery.data?.[session.id])
            return (
              <Link key={session.id} to={`/p/${project.id}/s/${session.id}`} className="group">
                <Card className="h-full gap-3 py-4 transition-colors group-hover:border-foreground/25">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-start justify-between gap-2 text-sm">
                      <span className="line-clamp-2">{session.title || 'Untitled session'}</span>
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
                      <span>{formatCost(session.cost)}</span>
                      <span>{formatRelativeTime(session.time.updated)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
