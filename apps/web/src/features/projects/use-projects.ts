import { useQuery } from '@tanstack/react-query'
import type { Project } from '@opencode/client'
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
function preferredProject(current: Project, candidate: Project): Project {
  if (Boolean(candidate.vcs) !== Boolean(current.vcs)) {
    return candidate.vcs ? candidate : current
  }
  return candidate.time.active > current.time.active ? candidate : current
}

/** One project record per canonical directory. */
export function canonicalProjects(projects: Project[]): Project[] {
  const byCanonical = new Map<string, Project>()
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
  projects: Project[],
  projectID: string | null | undefined
): Project | null {
  if (!projectID) return null
  const project = projects.find((item) => item.id === projectID)
  if (!project) return null
  return canonicalProjects(projects).find((item) => item.canonical === project.canonical) ?? project
}
