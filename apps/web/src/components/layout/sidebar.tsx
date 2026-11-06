import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderGit2,
  LayoutGrid,
  Loader2,
  Plus,
  RotateCw,
  Search,
  Settings,
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
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { SidebarSessionRow } from '@/components/layout/sidebar-session-row'
import { usePendingPermissions } from '@/features/chat/use-permissions'
import { resolveAttentionKind } from '@/features/notifications/attention'
import {
  filterVisibleProjects,
  projectLabel,
  recentProjects,
} from '@/features/projects/project-list'
import { useProjectReconciliation } from '@/features/projects/use-project-reconciliation'
import { useProjectSessionPresence } from '@/features/projects/use-project-presence'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'
import { canonicalProject, canonicalProjects, useProjects } from '@/features/projects/use-projects'
import { useSessionPolicy } from '@/features/notifications/session-policy'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox } from '@/features/sessions/session-sections'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import {
  useActiveSessions,
  useArchivedSessions,
  useSessions,
} from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
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

type SidebarSectionView = {
  id: SidebarSection
  label: string
  sessions: SessionInfo[]
}

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
  const location = useLocation()
  const params = useParams<{ projectId: string; sessionId?: string }>()
  const { lowerSingular, lowerPlural } = useSessionWording()
  const { info, reconnect, reconnecting } = useConnection()
  const { isAutomation } = useSessionPolicy()
  const claraEnabled = Boolean(isAutomation)
  const { state } = useEventStream()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const { reconcile, pending: reconciling } = useProjectReconciliation()
  const { showEmpty } = useShowEmptyProjects()
  const [search, setSearch] = useState('')
  const [openSections, setOpenSections] = useState(readSidebarSections)
  const searching = search.trim().length > 0

  const projectOptions = useMemo(() => canonicalProjects(projects), [projects])
  const projectIDs = useMemo(() => projectOptions.map((project) => project.id), [projectOptions])
  const { hasSessions, pending: presencePending } = useProjectSessionPresence(
    projectIDs,
    !showEmpty
  )
  const visibleProjectOptions = useMemo(
    () => filterVisibleProjects(projectOptions, hasSessions, showEmpty),
    [hasSessions, projectOptions, showEmpty]
  )

  const selectedProject = useMemo(() => {
    const fromUrl = canonicalProject(projects, params.projectId)
    if (fromUrl) return fromUrl
    return canonicalProject(projects, readLastProject()) ?? projectOptions[0] ?? null
  }, [params.projectId, projectOptions, projects])

  const recentProjectOptions = useMemo(() => {
    const options =
      !showEmpty &&
      selectedProject &&
      !visibleProjectOptions.some((project) => project.id === selectedProject.id)
        ? [...visibleProjectOptions, selectedProject]
        : visibleProjectOptions
    return recentProjects(options, selectedProject?.id)
  }, [selectedProject, showEmpty, visibleProjectOptions])

  const projectsPending =
    projectsQuery.isLoading ||
    (projects.length === 0 && reconciling) ||
    (!showEmpty && presencePending)

  const sessionsQuery = useSessions(selectedProject?.id ?? null, search)
  const archivedQuery = useArchivedSessions(selectedProject?.id ?? null, search)

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
    () =>
      allSessions.filter(
        (session) =>
          !isArchivedSession(session) && !isSnoozedSession(session) && !isAutomation?.(session)
      ),
    [allSessions, isAutomation]
  )
  const { signals: mailboxSignals, pending: mailboxesPending } =
    useSessionMailboxSignals(mailboxSessions)

  const permissionsQuery = usePendingPermissions(selectedProject?.canonical)
  const awaitingInput = useMemo(
    () => new Set((permissionsQuery.data ?? []).map((request) => request.sessionID)),
    [permissionsQuery.data]
  )

  const grouped = useMemo(
    () =>
      groupSessionsByMailbox(
        allSessions,
        mailboxSignals,
        activeQuery.data,
        awaitingInput,
        isAutomation
      ),
    [allSessions, mailboxSignals, activeQuery.data, awaitingInput, isAutomation]
  )

  const sections = useMemo<SidebarSectionView[]>(
    () => [
      { id: 'inbox', label: 'Inbox', sessions: grouped.inbox },
      { id: 'outbox', label: 'Outbox', sessions: grouped.outbox },
      { id: 'drafts', label: 'Drafts', sessions: grouped.drafts },
      { id: 'snoozed', label: 'Snoozed', sessions: grouped.snoozed },
      { id: 'archived', label: 'Archived', sessions: grouped.archived },
    ],
    [grouped]
  )
  const workerSection = useMemo<SidebarSectionView>(
    () => ({ id: 'workers', label: 'Workers', sessions: grouped.workers }),
    [grouped.workers]
  )
  const allSections = useMemo(
    () => (claraEnabled ? [...sections, workerSection] : sections),
    [claraEnabled, sections, workerSection]
  )

  const latest = sessions.find((session) => !isAutomation?.(session))
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

  const onSettings = location.pathname === '/settings'
  const allSectionsOpen = allSections.every((section) => openSections[section.id])
  const workersOpen = searching || openSections.workers

  const toggleAllSections = () => {
    const open = !allSectionsOpen
    const next = { ...openSections }
    for (const section of allSections) next[section.id] = open
    saveSidebarSections(next)
    setOpenSections(next)
  }

  const renderSessionRows = (section: SidebarSectionView) => {
    if (section.sessions.length === 0) {
      return (
        <div className="px-2 py-1 text-sm text-muted-foreground md:text-[11px]">
          No {lowerPlural}
        </div>
      )
    }

    return section.sessions.map((session) => {
      const signals = mailboxSignals.get(session.id)
      const attention = resolveAttentionKind(signals, session.agent, awaitingInput.has(session.id))
      return (
        <SidebarSessionRow
          key={session.id}
          session={session}
          projectID={selectedProject?.id ?? session.projectID}
          selected={session.id === params.sessionId}
          active={Boolean(activeQuery.data?.[session.id])}
          snoozed={section.id === 'snoozed'}
          blocked={attention === 'question'}
          error={section.id === 'inbox' && attention === 'error'}
          planReady={section.id === 'inbox' && attention === 'plan'}
          onNavigate={onNavigate}
        />
      )
    })
  }

  return (
    <>
      <div className="flex h-14 items-center gap-2 px-4">
        <img src="/clara-mark.png" alt="" className="size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <img src="/clara-type.png" alt="Clara" className="h-4 w-auto" />
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground md:text-[10px]">
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
        <Button asChild variant="ghost" size="icon" className="size-11 md:size-8">
          <Link
            to={onSettings ? '/' : '/settings'}
            onClick={onNavigate}
            title={onSettings ? 'Back to home' : 'Settings'}
          >
            <Settings className="size-5 md:size-4" />
            <span className="sr-only">{onSettings ? 'Back to home' : 'Settings'}</span>
          </Link>
        </Button>
        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onNavigate}
            title="Close navigation"
            className="size-11 md:size-8"
          >
            <X className="size-5 md:size-4" />
            <span className="sr-only">Close navigation</span>
          </Button>
        )}
      </div>

      <div className="px-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-auto w-full justify-between gap-2 px-3 py-2.5 text-left md:px-2.5 md:py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                {selectedProject ? (
                  <ProjectAvatar project={selectedProject} size="xs" />
                ) : (
                  <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium md:text-xs">
                    {selectedProject ? projectLabel(selectedProject) : 'Select project'}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground md:text-[10px]">
                    {selectedProject?.canonical ?? 'No project selected'}
                  </span>
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground md:size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Recent projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projectsPending && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
            )}
            {!projectsPending &&
              recentProjectOptions.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onSelect={() => selectProject(project.id)}
                  className="gap-2"
                >
                  <ProjectAvatar project={project} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{projectLabel(project)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {project.canonical}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            {!projectsPending && recentProjectOptions.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {showEmpty ? 'No projects found' : 'No projects with sessions'}
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void reconcile()}
              disabled={reconciling}
              title="Restore projects whose directories are available again"
              className="gap-2"
            >
              <RotateCw
                className={cn('size-3.5 text-muted-foreground', reconciling && 'animate-spin')}
              />
              <span className="min-w-0 flex-1 truncate text-xs">Refresh projects</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/projects" onClick={onNavigate} className="gap-2">
                <LayoutGrid className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">All projects</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {visibleProjectOptions.length}
                </span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        <Button
          className="h-11 w-full text-sm md:h-7 md:text-[0.8rem]"
          onClick={newSession}
          disabled={!selectedProject || createPending}
        >
          {createPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          New {lowerSingular}
        </Button>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground md:left-2.5 md:size-3.5" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${lowerPlural}`}
            className="h-10 pl-9 pr-14 text-base md:h-8 md:pl-8 md:pr-8 md:text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground md:size-5 max-md:size-11"
            >
              <X className="size-4 md:size-3.5 max-md:size-5" />
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleAllSections}
          disabled={searching}
          aria-pressed={allSectionsOpen}
          title={allSectionsOpen ? 'Collapse all groups' : 'Expand all groups'}
          className="size-11 shrink-0 md:size-8"
        >
          {allSectionsOpen ? (
            <ChevronsDownUp className="size-5 md:size-4" />
          ) : (
            <ChevronsUpDown className="size-5 md:size-4" />
          )}
          <span className="sr-only">
            {allSectionsOpen ? 'Collapse all groups' : 'Expand all groups'}
          </span>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2.5 md:px-2">
        {listPending && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full md:h-11" />
            ))}
          </div>
        )}

        {!listPending && sessionsError && (
          <div className="p-3 text-sm text-muted-foreground md:text-xs">
            Could not load {lowerPlural}.{' '}
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
          <div className="p-3 text-sm text-muted-foreground md:text-xs">
            {search
              ? `No ${lowerPlural} match your search.`
              : `No ${lowerPlural} yet. Start a new one.`}
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
                  <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground md:px-2 md:py-1.5 md:text-[10px]">
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0 transition-transform md:size-3',
                        open && 'rotate-90'
                      )}
                    />
                    <span>{section.label}</span>
                    <span className="ml-auto min-w-4 pr-1 text-right tabular-nums">
                      {section.sessions.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>{renderSessionRows(section)}</CollapsibleContent>
                </Collapsible>
              </div>
            )
          })}
      </ScrollArea>

      {claraEnabled && (
        <div className="shrink-0 border-t bg-sidebar px-2.5 md:px-2">
          <Collapsible
            open={workersOpen}
            onOpenChange={(next) => {
              if (!searching) setSectionOpen('workers', next)
            }}
          >
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground md:px-2 md:py-1.5 md:text-[10px]">
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform md:size-3',
                  workersOpen && 'rotate-90'
                )}
              />
              <span>{workerSection.label}</span>
              <span className="ml-auto min-w-4 pr-1 text-right tabular-nums">
                {workerSection.sessions.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-[min(16rem,45dvh)] overflow-y-auto pb-1">
                {renderSessionRows(workerSection)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      <div className="shrink-0 border-t px-3 py-2.5 text-[11px] text-muted-foreground md:py-2 md:text-[10px]">
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
