import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, FolderPlus, Loader2 } from 'lucide-react'
import { AddProjectDialog } from '@/components/projects/add-project-dialog'
import { PageShell } from '@/components/layout/page-shell'
import { ProjectCard } from '@/components/projects/project-card'
import { ProjectFilter } from '@/components/projects/project-filter'
import { Button } from '@/components/ui/button'
import { filterVisibleProjects, sortProjectsByRecency } from '@/features/projects/project-list'
import { useProjectSessionPresence } from '@/features/projects/use-project-presence'
import { useShowArchivedProjects } from '@/features/projects/use-show-archived-projects'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'
import { useArchivedProjects, useProjects } from '@/features/projects/use-projects'
import { formatCount } from '@/lib/format'

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const projectsQuery = useProjects()
  const archivedQuery = useArchivedProjects()
  const { showEmpty, setShowEmpty } = useShowEmptyProjects()
  const { showArchived } = useShowArchivedProjects()
  const [addOpen, setAddOpen] = useState(false)
  const active = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const archived = useMemo(() => archivedQuery.data ?? [], [archivedQuery.data])
  const projects = useMemo(
    () => sortProjectsByRecency(showArchived ? [...active, ...archived] : active),
    [active, archived, showArchived]
  )
  const projectIDs = useMemo(
    () => projects.filter((project) => project.workspaces.length > 0).map((project) => project.id),
    [projects]
  )
  const {
    hasSessions,
    pending: presencePending,
    failed: presenceFailed,
  } = useProjectSessionPresence(projectIDs, !showEmpty)
  const visibleProjects = useMemo(
    () => filterVisibleProjects(projects, hasSessions, showEmpty),
    [hasSessions, projects, showEmpty]
  )

  if (
    projectsQuery.isLoading ||
    (showArchived && archivedQuery.isLoading) ||
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
          <p className="mt-1 text-xs text-muted-foreground">The hub did not answer. Try again.</p>
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

  const hiddenCount = projects.length - visibleProjects.length

  return (
    <PageShell
      title="Projects"
      description={
        hiddenCount > 0
          ? `${formatCount(visibleProjects.length)} of ${formatCount(projects.length)} projects`
          : `${formatCount(visibleProjects.length)} ${visibleProjects.length === 1 ? 'project' : 'projects'}`
      }
      actions={
        <>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <FolderPlus className="size-4" /> New project
          </Button>
          <ProjectFilter />
        </>
      }
    >
      {presenceFailed && visibleProjects.length > 0 && (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Some projects could not be checked for sessions.{' '}
          <button
            className="underline"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['project-presence'] })}
          >
            Retry
          </button>
        </div>
      )}

      {visibleProjects.length === 0 ? (
        presenceFailed ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Could not check for sessions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The hub could not load sessions for these projects. Try again or show every project.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ['project-presence'] })
                }
              >
                Retry
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowEmpty(true)}>
                Show empty projects
              </Button>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No projects yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a Clara project, then add a directory on one or more paired harnesses.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
              <FolderPlus className="size-4" /> New project
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No projects with sessions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every visible project is empty{showArchived ? '' : ' or archived'}.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowEmpty(true)}>
              Show empty projects
            </Button>
          </div>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
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
