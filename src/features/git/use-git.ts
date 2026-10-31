import { useQuery } from '@tanstack/react-query'
import type { VcsFileStatus } from '@opencode/client'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type GitRange = 'working' | 'commits' | 'branch'

export function useGitInfo(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsInfo(directory),
    queryFn: () => client!.vcs.get({ location: { directory } }),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitBase(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsBase(directory),
    queryFn: () => client!.vcs.base({ location: { directory } }),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitChanges(
  directory: string | undefined,
  range: GitRange,
  base: string | undefined
) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsChanges(directory, range, base),
    queryFn: async (): Promise<VcsFileStatus[]> => {
      if (range === 'working') {
        const result = await client!.vcs.status({ location: { directory } })
        return result.data
      }

      const result = await client!.vcs.diff({
        location: { directory },
        mode: range === 'commits' ? 'committed' : 'branch',
        base,
        context: 0,
      })
      return result.data.map(({ file, additions, deletions, status }) => ({
        file,
        additions,
        deletions,
        status,
      }))
    },
    enabled: Boolean(client && directory && (range === 'working' || base)),
    staleTime: 10_000,
  })
}
