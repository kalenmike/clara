import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ClaraPermissionRequest,
  ClaraPermissionRequestListOutput,
  ClaraProjectWorkspace,
} from '@clara/api-contract'
import { unsnoozeSessionOnEngage } from '@/features/sessions/unsnooze'
import { harnessLocation, useHarnessScope } from '@/features/harness/harness-scope'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function usePendingPermissions(
  directory: string | undefined,
  harnessID?: string,
  options?: { enabled?: boolean }
) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.permissionsFor(directory, target),
    queryFn: () => client!.permission.request.list(harnessLocation(directory, target)),
    enabled: Boolean(client) && (options?.enabled ?? true),
    select: (result) => result.data,
    refetchInterval: 15_000,
  })
}

/**
 * Pending approvals for every workspace on a project. A project-wide session
 * list must not miss an approval that is waiting on another harness.
 */
export function useWorkspacePendingPermissions(
  workspaces: readonly ClaraProjectWorkspace[] | undefined
) {
  const { client } = useConnection()
  const targets = useMemo(() => {
    const seen = new Set<string>()
    const next: Array<{ directory: string; harnessID: string }> = []
    for (const workspace of workspaces ?? []) {
      if (!workspace.linked) continue
      const directory = workspace.canonical ?? workspace.directory
      const key = `${workspace.harnessID}:${directory}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push({ directory, harnessID: workspace.harnessID })
    }
    return next
  }, [workspaces])

  return useQueries({
    queries: targets.map(({ directory, harnessID }) => ({
      queryKey: queryKeys.permissionsFor(directory, harnessID),
      queryFn: () => client!.permission.request.list({ location: { directory }, harnessID }),
      enabled: Boolean(client),
      select: (result: ClaraPermissionRequestListOutput) => result.data,
      refetchInterval: 15_000,
    })),
    combine: (
      results: ReadonlyArray<{ data?: readonly ClaraPermissionRequest[]; isPending: boolean }>
    ) => ({
      requests: results.flatMap((result) => result.data ?? []),
      pending: results.some((result) => result.isPending),
    }),
  })
}

export function useReplyPermission() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      sessionID: string
      requestID: string
      decision: 'once' | 'always' | 'reject'
      message?: string
    }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, input.sessionID)
      return client!.permission.reply(input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissions })
    },
  })
}
