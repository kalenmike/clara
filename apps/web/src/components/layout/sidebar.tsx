import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderGit2,
  FolderPlus,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Server,
  Settings,
  X,
} from 'lucide-react'
import type { ClaraSession } from '@clara/api-contract'
import { toast } from 'sonner'
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
import { AddProjectDialog } from '@/components/projects/add-project-dialog'
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { SidebarSelectionBar } from '@/components/layout/sidebar-selection-bar'
import { SidebarSessionRow } from '@/components/layout/sidebar-session-row'
import { DeleteSessionDialog } from '@/components/sessions/delete-session-dialog'
import { useWorkspacePendingPermissions } from '@/features/chat/use-permissions'
import { usePruneEmptyDrafts } from '@/features/chat/use-prune-empty-drafts'
import { resolveAttentionKind } from '@/features/notifications/attention'
import {
  filterVisibleProjects,
  projectLabel,
  recentProjects,
} from '@/features/projects/project-list'
import { useProjectSessionPresence } from '@/features/projects/use-project-presence'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'
import {
  isWorkspaceStartable,
  projectSessionWorkspaces,
  projectSpansHarnesses,
  resolveProjectWorkspaceTarget,
  workspaceHarnessLabels,
} from '@/features/projects/project-workspaces'
import { findProject, useProjects } from '@/features/projects/use-projects'
import { resolveDeleteFocusTarget } from '@/features/sessions/delete-focus'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { groupSessionsByMailbox, mergeSessionLists } from '@/features/sessions/session-sections'
import {
  pruneSelection,
  selectRange,
  type SelectionState,
} from '@/features/sessions/session-selection'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { isSessionUnread } from '@/features/sessions/session-unread'
import {
  describeDeleteOutcome,
  useDeleteSessions,
  type DeleteOutcomeCopy,
} from '@/features/sessions/use-delete-sessions'
import { useSessionMailboxSignals } from '@/features/sessions/use-session-mailbox'
import {
  useActiveSessions,
  useArchivedSessions,
  useSessions,
} from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useSidebarWidth } from '@/hooks/use-sidebar-width'
import { claraBuildTitle, claraDisplayVersion } from '@/lib/build-info'
import { errorMessage } from '@/lib/errors'
import { isTextEntryTarget } from '@/lib/keyboard'
import { isDesktop } from '@/lib/runtime'
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  readLastProject,
  readLastWorkspace,
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
  sessions: ClaraSession[]
}

export function Sidebar() {
  const { width, dragging, handleProps } = useSidebarWidth()

  return (
    <aside
      className="relative hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex"
      style={{ width }}
    >
      <SidebarContent scope="sidebar" />
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

export function SidebarContent({
  onNavigate,
  scope = 'sidebar',
}: {
  onNavigate?: () => void
  scope?: 'sidebar' | 'drawer'
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ projectId: string; sessionId?: string }>()
  const { lowerSingular, lowerPlural } = useSessionWording()
  const { reconnect, reconnecting } = useConnection()
  const { state } = useEventStream()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const { showEmpty } = useShowEmptyProjects()
  const [search, setSearch] = useState('')
  const [openSections, setOpenSections] = useState(readSidebarSections)
  const [selection, setSelection] = useState<SelectionState>({
    anchorID: null,
    selectedIDs: new Set(),
  })
  const [failureNote, setFailureNote] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ClaraSession[]>([])
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>())
  const focusBeforeDialogRef = useRef<HTMLElement | null>(null)
  const beforeOrderRef = useRef<string[]>([])
  const pendingOutcomeRef = useRef<DeleteOutcomeCopy | null>(null)
  const pendingNavigationRef = useRef<string | null>(null)
  const focusIntentRef = useRef<{
    kind: 'dismiss' | 'success' | 'failure'
    deleted?: ReadonlySet<string>
    failed?: ReadonlySet<string>
  }>({ kind: 'dismiss' })
  const remove = useDeleteSessions()
  const searching = search.trim().length > 0

  const projectOptions = projects
  const projectIDs = useMemo(
    () =>
      projectOptions
        .filter((project) => project.workspaces.length > 0)
        .map((project) => project.id),
    [projectOptions]
  )
  const {
    hasSessions,
    incomplete: presenceIncomplete,
    pending: presencePending,
  } = useProjectSessionPresence(projectIDs, !showEmpty)
  const visibleProjectOptions = useMemo(
    () => filterVisibleProjects(projectOptions, hasSessions, showEmpty, presenceIncomplete),
    [hasSessions, presenceIncomplete, projectOptions, showEmpty]
  )

  const selectedProject = useMemo(() => {
    const fromUrl = findProject(projects, params.projectId)
    if (fromUrl) return fromUrl
    return findProject(projects, readLastProject()) ?? projectOptions[0] ?? null
  }, [params.projectId, projectOptions, projects])
  const sessionWorkspaces = useMemo(
    () => projectSessionWorkspaces(selectedProject),
    [selectedProject]
  )
  const harnessLabels = useMemo(
    () => workspaceHarnessLabels(sessionWorkspaces),
    [sessionWorkspaces]
  )
  const lastWorkspaceID = selectedProject ? readLastWorkspace(selectedProject.id) : null
  const workspaceTarget = useMemo(
    () => resolveProjectWorkspaceTarget(selectedProject, lastWorkspaceID),
    [lastWorkspaceID, selectedProject]
  )
  const sessionWorkspace = workspaceTarget.workspace
  const spansHarnesses = projectSpansHarnesses(selectedProject)

  const recentProjectOptions = useMemo(() => {
    const options =
      !showEmpty &&
      selectedProject &&
      !visibleProjectOptions.some((project) => project.id === selectedProject.id)
        ? [...visibleProjectOptions, selectedProject]
        : visibleProjectOptions
    return recentProjects(options, selectedProject?.id)
  }, [selectedProject, showEmpty, visibleProjectOptions])

  const projectsPending = projectsQuery.isLoading || (!showEmpty && presencePending)

  const projectHasWorkspaces = Boolean(selectedProject?.workspaces.length)
  const sessionsQuery = useSessions(selectedProject?.id ?? null, search, projectHasWorkspaces)
  const archivedQuery = useArchivedSessions(
    selectedProject?.id ?? null,
    search,
    projectHasWorkspaces
  )

  useEffect(() => {
    if (selectedProject) saveLastProject(selectedProject.id)
  }, [selectedProject])

  const sessions = useMemo(() => sessionsQuery.data?.data ?? [], [sessionsQuery.data])
  const archivedSessions = useMemo(() => archivedQuery.data?.data ?? [], [archivedQuery.data])
  const allSessions = useMemo(
    () => mergeSessionLists(sessions, archivedSessions),
    [sessions, archivedSessions]
  )

  const activeQuery = useActiveSessions()
  const mailboxSessions = useMemo(
    () =>
      allSessions.filter((session) => !isArchivedSession(session) && !isSnoozedSession(session)),
    [allSessions]
  )
  const { signals: mailboxSignals, pending: mailboxesPending } =
    useSessionMailboxSignals(mailboxSessions)

  usePruneEmptyDrafts({
    sessions: mailboxSessions,
    signals: mailboxSignals,
    running: activeQuery.data,
    enabled: !mailboxesPending && !params.sessionId,
  })

  const { requests: permissions } = useWorkspacePendingPermissions(selectedProject?.workspaces)
  const awaitingInput = useMemo(
    () => new Set(permissions.map((request) => request.sessionID)),
    [permissions]
  )

  const grouped = useMemo(
    // Group the full list: archived and snoozed sessions are filtered out of the
    // mailbox pool above, but they still need their own sections.
    () => groupSessionsByMailbox(allSessions, mailboxSignals, activeQuery.data, awaitingInput),
    [allSessions, mailboxSignals, activeQuery.data, awaitingInput]
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

  const renderedIDs = useMemo(() => {
    const ids: string[] = []
    for (const section of sections) {
      if (searching || openSections[section.id]) {
        for (const session of section.sessions) ids.push(session.id)
      }
    }
    return ids
  }, [openSections, searching, sections])

  const projectOrderedIDs = useMemo(
    () => sections.flatMap((section) => section.sessions.map((session) => session.id)),
    [sections]
  )

  const sessionByID = useMemo(
    () => new Map(allSessions.map((session) => [session.id, session])),
    [allSessions]
  )

  const selectedSessions = useMemo(
    () =>
      projectOrderedIDs.flatMap((id) => {
        const session = sessionByID.get(id)
        return session && selection.selectedIDs.has(id) ? [session] : []
      }),
    [projectOrderedIDs, selection.selectedIDs, sessionByID]
  )

  const renderedIDsRef = useRef(renderedIDs)
  renderedIDsRef.current = renderedIDs

  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const latest = sessions[0]
  const { startSession: newSession, pending: createPending } = useStartSession({
    projectID: selectedProject?.id,
    workspace: sessionWorkspace,
    agent: latest?.agent,
  })

  const sessionsLoading = sessionsQuery.isLoading || archivedQuery.isLoading
  const sessionsError = sessionsQuery.isError || archivedQuery.isError
  const sessionsAvailable = sessionsQuery.data !== undefined || archivedQuery.data !== undefined
  const sessionsErrorDetail = sessionsError
    ? errorMessage(sessionsQuery.error ?? archivedQuery.error)
    : null
  const listPending = sessionsLoading || (mailboxSessions.length > 0 && mailboxesPending)

  const projectOrderedIDsRef = useRef(projectOrderedIDs)
  projectOrderedIDsRef.current = projectOrderedIDs

  const select = useCallback((id: string) => {
    setSelection({ anchorID: id, selectedIDs: new Set() })
    setFailureNote(null)
  }, [])

  const extendTo = useCallback(
    (id: string) => {
      setSelection((current) => selectRange(renderedIDs, current.anchorID, id))
      setFailureNote(null)
    },
    [renderedIDs]
  )

  const clear = useCallback(() => {
    setSelection({ anchorID: null, selectedIDs: new Set() })
    setFailureNote(null)
  }, [])

  const openConfirm = useCallback(() => {
    if (selectedSessions.length === 0) {
      toast.message(`Select ${lowerPlural} to delete.`)
      return
    }

    focusIntentRef.current = { kind: 'dismiss' }
    beforeOrderRef.current = projectOrderedIDsRef.current
    pendingOutcomeRef.current = null
    pendingNavigationRef.current = null
    const active = document.activeElement
    focusBeforeDialogRef.current = active instanceof HTMLElement ? active : null
    setSnapshot([...selectedSessions])
    setDialogOpen(true)
  }, [lowerPlural, selectedSessions])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
  }, [])

  const confirmDelete = useCallback(() => {
    const targets = snapshot
    if (targets.length === 0 || remove.isPending) return

    remove.mutate(targets, {
      onSuccess: (result) => {
        const outcome = describeDeleteOutcome(result, { lowerSingular, lowerPlural })
        const failedIDs = new Set(result.failed.map((item) => item.session.id))

        if (!outcome) {
          focusIntentRef.current = { kind: 'dismiss' }
          setDialogOpen(false)
          return
        }

        pendingOutcomeRef.current = outcome

        if (outcome.tone === 'success') {
          focusIntentRef.current = { kind: 'success', deleted: new Set(result.deleted) }
          setSelection({ anchorID: null, selectedIDs: new Set() })
          setFailureNote(null)
        } else {
          const firstFailed =
            projectOrderedIDs.find((id) => failedIDs.has(id)) ??
            result.failed[0]?.session.id ??
            null
          const failedNoun = result.failed.length === 1 ? lowerSingular : lowerPlural
          const pronoun =
            result.failed.length === 1 ? 'It is still selected.' : 'They are still selected.'

          focusIntentRef.current = { kind: 'failure', failed: failedIDs }
          setSelection({ anchorID: firstFailed, selectedIDs: failedIDs })
          setFailureNote(`Could not delete ${result.failed.length} ${failedNoun}. ${pronoun}`)
        }

        const projectID = selectedProject?.id ?? targets[0]?.projectID
        if (params.sessionId && projectID && result.deleted.includes(params.sessionId)) {
          pendingNavigationRef.current = `/p/${projectID}`
        }

        setDialogOpen(false)
      },
      onError: () => {
        focusIntentRef.current = { kind: 'dismiss' }
        pendingOutcomeRef.current = {
          tone: 'error',
          title: `Could not delete ${targets.length} ${
            targets.length === 1 ? lowerSingular : lowerPlural
          }`,
        }
        pendingNavigationRef.current = null
        setDialogOpen(false)
      },
    })
  }, [
    lowerPlural,
    lowerSingular,
    params.sessionId,
    projectOrderedIDs,
    remove,
    selectedProject?.id,
    snapshot,
  ])

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault()
      const intent = focusIntentRef.current
      const outcome = pendingOutcomeRef.current
      const navigation = pendingNavigationRef.current
      pendingOutcomeRef.current = null
      pendingNavigationRef.current = null

      requestAnimationFrame(() => {
        if (outcome?.tone === 'success') {
          toast.success(outcome.title)
        } else if (outcome?.description) {
          toast.error(outcome.title, { description: outcome.description })
        } else if (outcome) {
          toast.error(outcome.title)
        }

        if (navigation) navigate(navigation)

        if (intent.kind === 'success') {
          const target = resolveDeleteFocusTarget(
            beforeOrderRef.current,
            renderedIDsRef.current,
            intent.deleted ?? new Set<string>()
          )
          const row = target ? rowRefs.current.get(target) : undefined
          if (row) {
            row.focus()
            return
          }
          searchInputRef.current?.focus()
          return
        }

        if (intent.kind === 'failure') {
          const failed = intent.failed ?? new Set<string>()
          for (const id of projectOrderedIDsRef.current) {
            if (!failed.has(id)) continue
            const row = rowRefs.current.get(id)
            if (row) {
              row.focus()
              return
            }
          }
          if (clearButtonRef.current) {
            clearButtonRef.current.focus()
            return
          }
          searchInputRef.current?.focus()
          return
        }

        const previous = focusBeforeDialogRef.current
        if (
          previous?.isConnected &&
          previous instanceof HTMLElement &&
          previous.dataset.sidebarSessionId
        ) {
          previous.focus()
          return
        }

        for (const id of projectOrderedIDsRef.current) {
          if (!selectionRef.current.selectedIDs.has(id)) continue
          const row = rowRefs.current.get(id)
          if (row) {
            row.focus()
            return
          }
        }

        if (clearButtonRef.current) {
          clearButtonRef.current.focus()
          return
        }
        searchInputRef.current?.focus()
      })
    },
    [navigate]
  )

  useEffect(() => {
    setSelection({ anchorID: null, selectedIDs: new Set() })
    setFailureNote(null)
    setDialogOpen(false)
  }, [params.projectId])

  useEffect(() => {
    setSelection({ anchorID: null, selectedIDs: new Set() })
    setFailureNote(null)
  }, [search])

  const sessionsSucceeded = sessionsQuery.isSuccess
  const archivedSucceeded = archivedQuery.isSuccess

  useEffect(() => {
    if (!sessionsSucceeded || !archivedSucceeded) return
    const availableIDs = new Set(allSessions.map((session) => session.id))
    const current = selectionRef.current
    const next = pruneSelection(current, availableIDs)
    if (next === current) return
    setSelection(next)
    setFailureNote(null)
  }, [allSessions, archivedSucceeded, sessionsSucceeded])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (selection.selectedIDs.size === 0) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.repeat) return
      if (event.isComposing || event.keyCode === 229) return
      if (isTextEntryTarget(event.target)) return
      if (dialogOpen || remove.isPending) return

      const wide = window.matchMedia('(min-width: 768px)').matches
      if (scope === 'sidebar' && !wide) return

      const sheetOpen = Boolean(document.querySelector('[data-slot="sheet-content"]'))
      if (scope === 'drawer' ? !sheetOpen : sheetOpen) return

      if (
        document.querySelector(
          '[data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"], [data-slot="popover-content"]'
        )
      ) {
        return
      }

      event.preventDefault()
      openConfirm()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dialogOpen, openConfirm, remove.isPending, scope, selection.selectedIDs.size])

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
  const allSectionsOpen = sections.every((section) => openSections[section.id])

  const toggleAllSections = () => {
    const open = !allSectionsOpen
    const next = { ...openSections }
    for (const section of sections) next[section.id] = open
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
          bulkSelected={selection.selectedIDs.has(session.id)}
          active={Boolean(activeQuery.data?.[session.id])}
          snoozed={section.id === 'snoozed'}
          blocked={attention === 'question'}
          error={section.id === 'inbox' && attention === 'error'}
          planReady={section.id === 'inbox' && attention === 'plan'}
          unread={section.id === 'inbox' && isSessionUnread(session)}
          onSelect={() => select(session.id)}
          onExtend={() => extendTo(session.id)}
          onNavigate={onNavigate}
          linkRef={(element) => {
            if (element) rowRefs.current.set(session.id, element)
            else rowRefs.current.delete(session.id)
          }}
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
                title="Reconnect to the harness"
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
        {isDesktop && (
          <Button asChild variant="ghost" size="icon" className="size-11 md:size-8">
            <Link to="/hub" onClick={onNavigate} title="Hub panel">
              <Server className="size-5 md:size-4" />
              <span className="sr-only">Hub panel</span>
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="icon" className="size-11 md:size-8">
          <Link to="/activity" onClick={onNavigate} title="Activity">
            <Activity className="size-5 md:size-4" />
            <span className="sr-only">Activity</span>
          </Link>
        </Button>
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
                    {selectedProject
                      ? sessionWorkspace
                        ? spansHarnesses
                          ? `${harnessLabels.get(sessionWorkspace.id) ?? sessionWorkspace.harnessLabel} · ${sessionWorkspace.directory}`
                          : sessionWorkspace.directory
                        : 'No workspace'
                      : 'No project selected'}
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
                      {project.workspaces[0]
                        ? projectSpansHarnesses(project)
                          ? `${project.workspaces[0].harnessLabel} · ${project.workspaces[0].directory}`
                          : project.workspaces[0].directory
                        : 'No workspaces'}
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
            <DropdownMenuItem onSelect={() => setAddProjectOpen(true)} className="gap-2">
              <FolderPlus className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">New project</span>
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
        <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        {sessionWorkspaces.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-11 w-full text-sm md:h-7 md:text-[0.8rem]"
                disabled={!selectedProject || createPending}
              >
                {createPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                New {lowerSingular}
                <ChevronDown className="ml-auto size-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>New {lowerSingular} in</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sessionWorkspaces.map((workspace) => {
                const harnessLabel = harnessLabels.get(workspace.id) ?? workspace.harnessLabel
                const startable = isWorkspaceStartable(workspace)
                return (
                  <DropdownMenuItem
                    key={workspace.id}
                    disabled={!startable}
                    onSelect={() => newSession(workspace)}
                    className="gap-2"
                  >
                    <FolderGit2 className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">
                        {workspace.label ?? harnessLabel}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {workspace.label
                          ? `${harnessLabel} · ${workspace.directory}`
                          : workspace.directory}
                      </span>
                    </span>
                    {!startable && (
                      <span className="text-[10px] text-muted-foreground">
                        {workspace.online ? 'Unlinked' : 'Offline'}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            className="h-11 w-full text-sm md:h-7 md:text-[0.8rem]"
            onClick={() => newSession()}
            disabled={
              !selectedProject || !sessionWorkspace || !workspaceTarget.startable || createPending
            }
          >
            {createPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New {lowerSingular}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground md:left-2.5 md:size-3.5" />
          <Input
            ref={searchInputRef}
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

      <SidebarSelectionBar
        selectedSessions={selectedSessions}
        failureNote={failureNote}
        onClear={clear}
        onDelete={openConfirm}
        clearRef={clearButtonRef}
      />

      <ScrollArea className="min-h-0 flex-1 px-2.5 md:px-2">
        {listPending && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full md:h-11" />
            ))}
          </div>
        )}

        {!listPending && sessionsError && !sessionsAvailable && (
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
            {sessionsErrorDetail && (
              <span className="mt-1 block break-words text-[10px] text-muted-foreground/70">
                {sessionsErrorDetail}
              </span>
            )}
          </div>
        )}

        {!listPending && sessionsError && sessionsAvailable && (
          <div className="px-3 pb-2 text-[10px] text-muted-foreground md:text-[11px]">
            Could not refresh {lowerPlural}.{' '}
            <button
              className="underline"
              onClick={() => {
                void sessionsQuery.refetch()
                void archivedQuery.refetch()
              }}
            >
              Retry
            </button>
            {sessionsErrorDetail && (
              <span className="mt-0.5 block break-words text-muted-foreground/70">
                {sessionsErrorDetail}
              </span>
            )}
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
          (!sessionsError || sessionsAvailable) &&
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

      <div className="shrink-0 border-t px-3 py-2.5 text-[11px] text-muted-foreground md:py-2 md:text-[10px]">
        <div className="flex justify-end">
          <span className="truncate" title={claraBuildTitle}>
            Clara {claraDisplayVersion}
          </span>
        </div>
      </div>

      <DeleteSessionDialog
        open={dialogOpen}
        sessions={snapshot}
        deleting={remove.isPending}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        onCancel={closeDialog}
        onConfirm={confirmDelete}
        onCloseAutoFocus={handleCloseAutoFocus}
      />
    </>
  )
}
