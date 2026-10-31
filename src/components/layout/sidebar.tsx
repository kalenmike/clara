import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { SidebarSessionRow } from '@/components/layout/sidebar-session-row'
import { usePendingPermissions } from '@/features/chat/use-permissions'
import { resolveAttentionKind } from '@/features/notifications/attention'
import { useProjects } from '@/features/projects/use-projects'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox } from '@/features/sessions/session-sections'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import {
  useActiveSessions,
  useArchivedSessions,
  useSessions,
} from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { useSidebarWidth } from '@/hooks/use-sidebar-width'
import { claraBuildLabel, claraBuildTitle, claraVersion } from '@/lib/build-info'
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  readLastProject,
  readSidebarSections,
  saveLastProject,
  saveSidebarSections,
  type SidebarSection,
} from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const { width, dragging, handleProps } = useSidebarWidth()

  return (
    <aside
      className="relative hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex"
      style={{ width }}
    >
      <SidebarContent />
      <div
        {...handleProps}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        tabIndex={0}
        className={cn(
          'group absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none outline-none',
          'focus-visible:bg-primary/10'
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 right-0 w-px transition-colors',
            dragging
              ? 'bg-primary'
              : 'bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary'
          )}
        />
      </div>
    </aside>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const params = useParams<{ projectId: string; sessionId?: string }>()
  const { info, reconnect, reconnecting } = useConnection()
  const { state } = useEventStream()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const [search, setSearch] = useState('')
  const [openSections, setOpenSections] = useState(readSidebarSections)
  const searching = search.trim().length > 0

  const selectedProject = useMemo(() => {
    const fromUrl = projects.find((project) => project.id === params.projectId)
    if (fromUrl) return fromUrl
    const last = readLastProject()
    return projects.find((project) => project.id === last) ?? projects[0] ?? null
  }, [params.projectId, projects])

  const sessionsQuery = useSessions(selectedProject?.canonical ?? null, search)
  const archivedQuery = useArchivedSessions(selectedProject?.canonical ?? null, search)

  useEffect(() => {
    if (selectedProject) saveLastProject(selectedProject.id)
  }, [selectedProject])

  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const archivedSessions = useMemo(() => archivedQuery.data?.data ?? [], [archivedQuery.data])
  const allSessions = useMemo(() => {
    const byID = new Map<string, SessionInfo>()
    for (const session of archivedSessions) byID.set(session.id, session)
    for (const session of sessions) {
      if (!byID.has(session.id)) byID.set(session.id, session)
    }
    return [...byID.values()]
  }, [sessions, archivedSessions])

  const activeQuery = useActiveSessions()
  const mailboxSessions = useMemo(
    () => allSessions.filter((session) => !isArchivedSession(session)),
    [allSessions]
  )
  const { signals: mailboxSignals, pending: mailboxesPending } =
    useSessionMailboxSignals(mailboxSessions)

  const permissionsQuery = usePendingPermissions(selectedProject?.canonical)
  const awaitingInput = useMemo(
    () => new Set((permissionsQuery.data ?? []).map((request) => request.sessionID)),
    [permissionsQuery.data]
  )

  const sections = useMemo(() => {
    const grouped = groupSessionsByMailbox(
      allSessions,
      mailboxSignals,
      activeQuery.data,
      awaitingInput
    )

    return [
      { id: 'inbox', label: 'Inbox', sessions: grouped.inbox },
      { id: 'outbox', label: 'Outbox', sessions: grouped.outbox },
      { id: 'drafts', label: 'Drafts', sessions: grouped.drafts },
      { id: 'archived', label: 'Archived', sessions: grouped.archived },
    ] satisfies Array<{ id: SidebarSection; label: string; sessions: SessionInfo[] }>
  }, [allSessions, mailboxSignals, activeQuery.data, awaitingInput])

  const latest = sessions[0]
  const { startSession: newSession, pending: createPending } = useStartSession({
    projectID: selectedProject?.id,
    directory: selectedProject?.canonical,
    agent: latest?.agent,
    model: latest?.model,
  })

  const sessionsLoading = sessionsQuery.isLoading || archivedQuery.isLoading
  const sessionsError = sessionsQuery.isError || archivedQuery.isError
  const listPending = sessionsLoading || (mailboxSessions.length > 0 && mailboxesPending)

  const selectProject = (projectID: string) => {
    saveLastProject(projectID)
    navigate(`/p/${projectID}`)
    onNavigate?.()
  }

  const setSectionOpen = (section: SidebarSection, open: boolean) => {
    setOpenSections((current) => {
      const next = { ...current, [section]: open }
      saveSidebarSections(next)
      return next
    })
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
            {state === 'live' ? (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                live
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void reconnect()}
                disabled={reconnecting}
                title="Reconnect to the OpenCode server"
                className="flex items-center gap-1 rounded-sm uppercase tracking-wider transition-colors hover:text-foreground disabled:opacity-60"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    reconnecting ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground/40'
                  )}
                />
                {reconnecting || state === 'connecting' ? 'reconnecting' : 'retry'}
              </button>
            )}
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
          disabled={!selectedProject || createPending}
        >
          {createPending ? (
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
            className="h-8 pl-8 pr-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        {listPending && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        )}

        {!listPending && sessionsError && (
          <div className="p-3 text-xs text-muted-foreground">
            Could not load sessions.{' '}
            <button
              className="underline"
              onClick={() => {
                void sessionsQuery.refetch()
                void archivedQuery.refetch()
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!listPending && !sessionsError && allSessions.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">
            {search ? 'No sessions match your search.' : 'No sessions yet. Start a new one.'}
          </div>
        )}

        {!listPending &&
          !sessionsError &&
          sections.map((section) => {
            const open = searching || openSections[section.id]
            return (
              <div key={section.id} className="pb-2">
                <Collapsible
                  open={open}
                  onOpenChange={(next) => {
                    if (!searching) setSectionOpen(section.id, next)
                  }}
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground">
                    <ChevronRight
                      className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
                    />
                    <span>{section.label}</span>
                    <span className="ml-auto min-w-4 text-right tabular-nums">
                      {section.sessions.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {section.sessions.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">No sessions</div>
                    ) : (
                      section.sessions.map((session) => {
                        const signals = mailboxSignals.get(session.id)
                        const attention = resolveAttentionKind(
                          signals,
                          session.agent,
                          awaitingInput.has(session.id)
                        )
                        return (
                          <SidebarSessionRow
                            key={session.id}
                            session={session}
                            projectID={selectedProject?.id ?? session.projectID}
                            selected={session.id === params.sessionId}
                            active={Boolean(activeQuery.data?.[session.id])}
                            blocked={attention === 'question'}
                            error={section.id === 'inbox' && attention === 'error'}
                            planReady={section.id === 'inbox' && attention === 'plan'}
                            onNavigate={onNavigate}
                          />
                        )
                      })
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )
          })}
      </ScrollArea>

      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{info ? `OpenCode ${info.version}` : 'Not connected'}</span>
          <span className="truncate" title={claraBuildTitle}>
            Clara {claraVersion} · {claraBuildLabel}
          </span>
        </div>
      </div>
    </>
  )
}
