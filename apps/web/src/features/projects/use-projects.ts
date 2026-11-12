import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClaraProject } from '@clara/api-contract'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useProjects() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => client!.project.list(),
    enabled: Boolean(client),
    staleTime: 30_000,
  })
}

/**
 * The server can keep more than one project record for the same directory, for
 * example before and after `git init`. Prefer the VCS-backed record, then the
 * most recently active one.
 */
function preferredProject(current: ClaraProject, candidate: ClaraProject): ClaraProject {
  if (Boolean(candidate.vcs) !== Boolean(current.vcs)) {
    return candidate.vcs ? candidate : current
  }
  return candidate.time.active > current.time.active ? candidate : current
}

/** One project record per canonical directory. */
export function canonicalProjects(projects: ClaraProject[]): ClaraProject[] {
  const byCanonical = new Map<string, ClaraProject>()
  for (const project of projects) {
    const current = byCanonical.get(project.canonical)
    byCanonical.set(project.canonical, current ? preferredProject(current, project) : project)
  }
  return [...byCanonical.values()]
}

/**
 * Resolve a route or remembered project ID to the record that owns its
 * sessions. Sessions are scoped by project ID, so a stale duplicate record
 * would otherwise hide every session in the directory.
 */
export function canonicalProject(
  projects: ClaraProject[],
  projectID: string | null | undefined
): ClaraProject | null {
  if (!projectID) return null
  const project = projects.find((item) => item.id === projectID)
  if (!project) return null
  return canonicalProjects(projects).find((item) => item.canonical === project.canonical) ?? project
}

type ProjectUpdatePatch = {
  name?: string
  icon?: ClaraProject['icon']
  commands?: ClaraProject['commands']
}

/**
 * Update project metadata on the harness server. Every client reads the same
 * record, so Clara keeps no local overrides for name, icon, or commands.
 */
export function useUpdateProject(projectID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: ProjectUpdatePatch) => client!.project.update({ projectID, ...patch }),
    onSuccess: (project) => {
      queryClient.setQueryData<ClaraProject[]>(queryKeys.projects, (current) =>
        current?.map((item) => (item.id === project.id ? project : item))
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}
