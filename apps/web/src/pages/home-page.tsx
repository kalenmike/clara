import { useEffect, useMemo } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { EmptySessionView } from '@/components/chat/empty-session-view'
import { InboxMonitorToggle } from '@/components/chat/inbox-monitor-toggle'
import { useHarnessLabel } from '@/features/harness/use-harness-label'
import { resolveProjectWorkspaceTarget } from '@/features/projects/project-workspaces'
import { findProject, useProjects } from '@/features/projects/use-projects'
import { useSessions } from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
import { readLastProject, readLastWorkspace, saveLastProject } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

export function HomePage() {
  const { status } = useConnection()
  const label = useHarnessLabel()
  const { lowerSingular } = useSessionWording()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const last = readLastProject()
  const project = useMemo(
    () => findProject(projects, last) ?? projects[0] ?? null,
    [last, projects]
  )
  const lastWorkspaceID = project ? readLastWorkspace(project.id) : null
  const workspaceTarget = useMemo(
    () => resolveProjectWorkspaceTarget(project, lastWorkspaceID),
    [lastWorkspaceID, project]
  )
  const workspace = workspaceTarget.workspace
  const sessionsQuery = useSessions(project?.id ?? null, '', Boolean(project?.workspaces.length))
  const latest = sessionsQuery.data?.data[0]
  const { startSession, pending } = useStartSession({
    projectID: project?.id,
    workspace,
    agent: latest?.agent,
  })

  useEffect(() => {
    if (project) saveLastProject(project.id)
  }, [project])

  if (status !== 'connected' || projectsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading projects…
      </div>
    )
  }

  if (!project) {
    return (
      <EmptySessionView
        title="No projects yet"
        description="Create a Clara project from the sidebar, then add a directory on a paired harness."
      />
    )
  }

  if (!workspace) {
    return (
      <EmptySessionView
        title="Add a workspace"
        description={`${label} does not know where to run work for this project yet. Add a directory on the project page.`}
      />
    )
  }

  if (!workspaceTarget.startable) {
    return (
      <EmptySessionView
        title={`${workspace.harnessLabel || label} is offline`}
        description={`Reconnect it, or choose another workspace from the project menu, before starting a new ${lowerSingular}.`}
        footer={<InboxMonitorToggle />}
      />
    )
  }

  return (
    <EmptySessionView
      title="What's next on the list?"
      description="Give Clara something to work on!"
      actionLabel={`New ${lowerSingular}`}
      actionIcon={<Plus className="size-4" />}
      onAction={() => startSession()}
      actionPending={pending}
      footer={<InboxMonitorToggle />}
    />
  )
}
