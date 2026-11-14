import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClaraProject } from '@clara/api-contract'
import type { ClaraProjectDeleteInput, ClaraProjectUpdateInput } from '@clara/api-client'
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

export function useArchivedProjects() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.archivedProjects,
    queryFn: () => client!.project.list({ archived: true }),
    enabled: Boolean(client),
    staleTime: 30_000,
  })
}

export function useHarnesses() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.harnesses,
    queryFn: () => client!.harness.list(),
    enabled: Boolean(client),
    staleTime: 30_000,
    // A newly paired harness must start streaming without a page reload.
    refetchInterval: 30_000,
  })
}

export function useAvailableProjects(harnessID: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.projectAvailable(harnessID),
    queryFn: () => client!.project.available({ harnessID }),
    enabled: Boolean(client) && Boolean(harnessID),
    staleTime: 15_000,
  })
}

export function useProject(projectID: string | null | undefined) {
  const active = useProjects()
  const archived = useArchivedProjects()
  return {
    project: findProject(active.data, projectID) ?? findProject(archived.data, projectID),
    isLoading: active.isLoading || archived.isLoading,
  }
}

export function findProject(
  projects: ClaraProject[] | undefined,
  projectID: string | null | undefined
): ClaraProject | null {
  if (!projectID) return null
  return projects?.find((item) => item.id === projectID) ?? null
}

function useInvalidateProjects() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    void queryClient.invalidateQueries({ queryKey: queryKeys.archivedProjects })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: ['project-presence'] })
    void queryClient.invalidateQueries({ queryKey: ['project-stats'] })
    void queryClient.invalidateQueries({ queryKey: ['git'] })
  }
}

export function useCreateProject() {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (input: {
      name?: string
      icon?: Record<string, unknown>
      commands?: Record<string, unknown>
      startupScript?: string
    }) => client!.project.create(input),
    onSuccess: invalidate,
  })
}

export function useUpdateProject(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (patch: Omit<ClaraProjectUpdateInput, 'projectID'>) =>
      client!.project.update({ projectID, ...patch }),
    onSuccess: invalidate,
  })
}

export function useArchiveProject(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (archived: boolean) =>
      archived ? client!.project.archive({ projectID }) : client!.project.unarchive({ projectID }),
    onSuccess: invalidate,
  })
}

export function useDeleteProject(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (mode: NonNullable<ClaraProjectDeleteInput['mode']> = 'propagate') =>
      client!.project.remove({ projectID, mode }),
    onSuccess: invalidate,
  })
}

export function useAddProjectWorkspace(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (input: { harnessID: string; directory: string; label?: string }) =>
      client!.project.workspace.add({ projectID, ...input }),
    onSuccess: invalidate,
  })
}

export function useRemoveProjectWorkspace(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: (workspaceID: string) =>
      client!.project.workspace.remove({ projectID, workspaceID }),
    onSuccess: invalidate,
  })
}

export function useSyncProject(projectID: string) {
  const { client } = useConnection()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: () => client!.project.sync({ projectID }),
    onSuccess: invalidate,
  })
}
