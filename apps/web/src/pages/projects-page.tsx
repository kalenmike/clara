import { useMemo } from 'react'
import { Link } from 'react-router'
import { FolderGit2, Loader2 } from 'lucide-react'
import { PageShell } from '@/components/layout/page-shell'
import { ProjectCard } from '@/components/projects/project-card'
import { ProjectFilter } from '@/components/projects/project-filter'
import { Button } from '@/components/ui/button'
import { filterVisibleProjects, sortProjectsByRecency } from '@/features/projects/project-list'
import { useProjectReconciliation } from '@/features/projects/use-project-reconciliation'
import { useProjectSessionPresence } from '@/features/projects/use-project-presence'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'
import { canonicalProjects, useProjects } from '@/features/projects/use-projects'
import { formatCount } from '@/lib/format'

export function ProjectsPage() {
  const projectsQuery = useProjects()
  const { pending: reconciling } = useProjectReconciliation()
  const { showEmpty, setShowEmpty } = useShowEmptyProjects()
  const projects = useMemo(
    () => sortProjectsByRecency(canonicalProjects(projectsQuery.data ?? [])),
    [projectsQuery.data]
  )
  const projectIDs = useMemo(() => projects.map((project) => project.id), [projects])
  const { hasSessions, pending: presencePending } = useProjectSessionPresence(
    projectIDs,
    !showEmpty
  )
  const visibleProjects = useMemo(
    () => filterVisibleProjects(projects, hasSessions, showEmpty),
    [hasSessions, projects, showEmpty]
  )

  if (
    projectsQuery.isLoading ||
    (projects.length === 0 && reconciling) ||
    (!showEmpty && presencePending)
  ) {
    return (
      <Centered>
        <Loader2 className="size-4 animate-spin" /> Loading projects…
      </Centered>
    )
  }

  if (projectsQuery.isError) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-sm font-medium">Could not load projects</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The OpenCode server did not answer. Try again.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void projectsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </Centered>
    )
  }

  if (projects.length === 0) {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No projects yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open a directory with OpenCode first. Projects appear here once the server has seen
            them.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </Centered>
    )
  }

  const hiddenCount = projects.length - visibleProjects.length

  return (
    <PageShell
      title="Projects"
      description={
        hiddenCount > 0
          ? `${formatCount(visibleProjects.length)} of ${formatCount(projects.length)} projects on this OpenCode server`
          : `${formatCount(visibleProjects.length)} ${visibleProjects.length === 1 ? 'project' : 'projects'} on this OpenCode server`
      }
      actions={<ProjectFilter />}
    >
      {visibleProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No projects with sessions</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every project on this OpenCode server is empty.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowEmpty(true)}>
            Show empty projects
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
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
