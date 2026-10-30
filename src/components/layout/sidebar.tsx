import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ChevronDown,
  CircleDot,
  FolderGit2,
  Loader2,
  Plus,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/features/projects/use-projects'
import { useActiveSessions, useCreateSession, useSessions } from '@/features/sessions/use-sessions'
import { formatRelativeTime } from '@/lib/format'
import { readLastProject, saveLastProject } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { cn } from '@/lib/utils'

function groupSessions(sessions: SessionInfo[]) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  const groups: Array<{ label: string; sessions: SessionInfo[] }> = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Previous 7 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ]

  for (const session of sessions) {
    const time = session.time.updated
    if (time >= startOfToday) groups[0].sessions.push(session)
    else if (time >= startOfToday - day) groups[1].sessions.push(session)
    else if (time >= startOfToday - 7 * day) groups[2].sessions.push(session)
    else groups[3].sessions.push(session)
  }

  return groups.filter((group) => group.sessions.length > 0)
}

export function Sidebar() {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <SidebarContent />
    </aside>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const params = useParams<{ projectId: string; sessionId?: string }>()
  const { info } = useConnection()
  const { live } = useEventStream()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const [search, setSearch] = useState('')

  const selectedProject = useMemo(() => {
    const fromUrl = projects.find((project) => project.id === params.projectId)
    if (fromUrl) return fromUrl
    const last = readLastProject()
    return projects.find((project) => project.id === last) ?? projects[0] ?? null
  }, [params.projectId, projects])

  const sessionsQuery = useSessions(selectedProject?.canonical ?? null, search)
  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const activeQuery = useActiveSessions()
  const createSession = useCreateSession(selectedProject?.canonical ?? '')

  const groups = useMemo(() => groupSessions(sessions), [sessions])

  const selectProject = (projectID: string) => {
    saveLastProject(projectID)
    navigate(`/p/${projectID}`)
    onNavigate?.()
  }

  const newSession = () => {
    if (!selectedProject) return
    const latest = sessions[0]
    createSession.mutate(
      { agent: latest?.agent, model: latest?.model },
      {
        onSuccess: (session) => {
          navigate(`/p/${selectedProject.id}/s/${session.id}`)
          onNavigate?.()
        },
      }
    )
  }

  return (
    <>
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight tracking-tight">Clara</div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                live ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              )}
            />
            {live ? 'live' : 'offline'}
          </div>
        </div>
        <Button asChild variant="ghost" size="icon" className="size-8">
          <Link to="/settings" onClick={onNavigate}>
            <Settings className="size-4" />
            <span className="sr-only">Settings</span>
          </Link>
        </Button>
      </div>

      <div className="px-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-auto w-full justify-between gap-2 px-2.5 py-2 text-left"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {selectedProject?.name ??
                      selectedProject?.canonical.split('/').pop() ??
                      'Select project'}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {selectedProject?.canonical ?? 'No project selected'}
                  </span>
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projectsQuery.isLoading && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
            )}
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => selectProject(project.id)}
                className="gap-2"
              >
                <FolderGit2 className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">
                    {project.name ?? project.canonical}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {project.canonical}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            {projects.length === 0 && !projectsQuery.isLoading && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No projects found</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex gap-2 px-3 pb-3">
        <Button
          size="sm"
          className="flex-1"
          onClick={newSession}
          disabled={!selectedProject || createSession.isPending}
        >
          {createSession.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          New session
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sessions"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        {sessionsQuery.isLoading && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        )}

        {sessionsQuery.isError && (
          <div className="p-3 text-xs text-muted-foreground">
            Could not load sessions.{' '}
            <button className="underline" onClick={() => sessionsQuery.refetch()}>
              Retry
            </button>
          </div>
        )}

        {!sessionsQuery.isLoading && sessions.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">
            {search ? 'No sessions match your search.' : 'No sessions yet. Start a new one.'}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="pb-2">
            <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            {group.sessions.map((session) => {
              const active = Boolean(activeQuery.data?.[session.id])
              const selected = session.id === params.sessionId
              return (
                <Link
                  key={session.id}
                  to={`/p/${selectedProject?.id ?? session.projectID}/s/${session.id}`}
                  onClick={onNavigate}
                  className={cn(
                    'group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent',
                    selected && 'bg-sidebar-accent'
                  )}
                >
                  {active ? (
                    <CircleDot className="mt-1 size-3 shrink-0 animate-pulse text-emerald-500" />
                  ) : (
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {session.title || 'Untitled session'}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="truncate">{session.agent ?? 'build'}</span>
                      <span>·</span>
                      <span className="truncate">{session.model?.id ?? 'default'}</span>
                      <span>·</span>
                      <span className="shrink-0">{formatRelativeTime(session.time.updated)}</span>
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        ))}
      </ScrollArea>

      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{info ? `OpenCode ${info.version}` : 'Not connected'}</span>
          <span className="truncate">⌘/ctrl + X shortcuts</span>
        </div>
      </div>
    </>
  )
}
