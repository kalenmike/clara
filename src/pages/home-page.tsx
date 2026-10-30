import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useProjects } from '@/features/projects/use-projects'
import { readLastProject, saveLastProject } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

export function HomePage() {
  const { status } = useConnection()
  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? []
  const last = readLastProject()
  const project = projects.find((item) => item.id === last) ?? projects[0]

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
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold">No projects yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Open a directory with OpenCode first. Projects appear here once the server has seen them.
        </p>
      </div>
    )
  }

  return <Navigate to={`/p/${project.id}`} replace />
}
