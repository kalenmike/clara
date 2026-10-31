import { useEffect, useMemo } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { EmptySessionView } from '@/components/chat/empty-session-view'
import { useProjects } from '@/features/projects/use-projects'
import { useSessions } from '@/features/sessions/use-sessions'
import { useStartSession } from '@/features/sessions/use-start-session'
import { readLastProject, saveLastProject } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

export function HomePage() {
  const { status } = useConnection()
  const projectsQuery = useProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const last = readLastProject()
  const project = useMemo(
    () => projects.find((item) => item.id === last) ?? projects[0] ?? null,
    [last, projects]
  )
  const sessionsQuery = useSessions(project?.canonical ?? null, '')
  const latest = sessionsQuery.data?.data[0]
  const { startSession, pending } = useStartSession({
    projectID: project?.id,
    directory: project?.canonical,
    agent: latest?.agent,
    model: latest?.model,
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
        description="Open a directory with OpenCode first. Projects appear here once the server has seen them."
      />
    )
  }

  return (
    <EmptySessionView
      projectName={project.name ?? project.canonical}
      title="Start a new session"
      description="Draft your initial prompt below to start working with the agent. Use / for commands or @ to reference files and agents."
      actionLabel="New Session"
      actionIcon={<Plus className="size-4" />}
      onAction={startSession}
      actionPending={pending}
    />
  )
}
