import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ClaraAgent, ClaraModel, ClaraProvider } from '@clara/api-contract'
import { resolveHarnessID, useHarnessScope } from '@/features/harness/harness-scope'
import { harnessKey, queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

function useCatalogHarness(harnessID: string | undefined): string | undefined {
  return resolveHarnessID(harnessID, useHarnessScope())
}

export function useAgents(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.agents(target),
    queryFn: () => client!.agent.list({ harnessID: target! }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
  })
}

export function useModels(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.models(target),
    queryFn: () => client!.model.list({ harnessID: target! }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

/**
 * Model catalogs for several harnesses at once. Sessions page cost estimates
 * need each session's own prices, and every harness prices its models itself.
 */
export function useModelsForHarnesses(harnessIDs: readonly string[]) {
  const { client } = useConnection()
  const targets = useMemo(() => {
    const seen = new Set<string>()
    const next: string[] = []
    for (const harnessID of harnessIDs) {
      const key = harnessKey(harnessID)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(harnessID)
    }
    return next
  }, [harnessIDs])

  const queries = useQueries({
    queries: targets.map((harnessID) => ({
      queryKey: queryKeys.models(harnessID),
      queryFn: () => client!.model.list({ harnessID }),
      enabled: Boolean(client),
      staleTime: 60_000,
    })),
  })

  const catalogs = new Map<string, readonly ClaraModel[] | undefined>()
  targets.forEach((harnessID, index) => {
    catalogs.set(harnessKey(harnessID), queries[index]?.data?.data)
  })
  return catalogs
}

export type HarnessCatalogResult<T> = {
  data: readonly T[] | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
}

function catalogMap<T>(
  harnessIDs: readonly string[],
  queries: ReadonlyArray<{
    data?: { data: T[] }
    isPending: boolean
    isError: boolean
    refetch: () => void
  }>
): Map<string, HarnessCatalogResult<T>> {
  const results = new Map<string, HarnessCatalogResult<T>>()
  harnessIDs.forEach((harnessID, index) => {
    const query = queries[index]
    results.set(harnessID, {
      data: query?.data?.data,
      isPending: query?.isPending ?? true,
      isError: query?.isError ?? false,
      refetch: () => void query?.refetch(),
    })
  })
  return results
}

function uniqueHarnesses(harnessIDs: readonly string[]): string[] {
  return [...new Set(harnessIDs)]
}

export function useModelsForHarnessDetails(
  harnessIDs: readonly string[]
): Map<string, HarnessCatalogResult<ClaraModel>> {
  const { client } = useConnection()
  const targets = useMemo(() => uniqueHarnesses(harnessIDs), [harnessIDs])
  const queries = useQueries({
    queries: targets.map((harnessID) => ({
      queryKey: queryKeys.models(harnessID),
      queryFn: () => client!.model.list({ harnessID }),
      enabled: Boolean(client),
      staleTime: 60_000,
    })),
  })
  return catalogMap(targets, queries)
}

export function useProvidersForHarnessDetails(
  harnessIDs: readonly string[]
): Map<string, HarnessCatalogResult<ClaraProvider>> {
  const { client } = useConnection()
  const targets = useMemo(() => uniqueHarnesses(harnessIDs), [harnessIDs])
  const queries = useQueries({
    queries: targets.map((harnessID) => ({
      queryKey: queryKeys.providers(harnessID),
      queryFn: () => client!.provider.list({ harnessID }),
      enabled: Boolean(client),
      staleTime: 60_000,
    })),
  })
  return catalogMap(targets, queries)
}

export function useAgentsForHarnessDetails(
  harnessIDs: readonly string[]
): Map<string, HarnessCatalogResult<ClaraAgent>> {
  const { client } = useConnection()
  const targets = useMemo(() => uniqueHarnesses(harnessIDs), [harnessIDs])
  const queries = useQueries({
    queries: targets.map((harnessID) => ({
      queryKey: queryKeys.agents(harnessID),
      queryFn: () => client!.agent.list({ harnessID }),
      enabled: Boolean(client),
    })),
  })
  return catalogMap(targets, queries)
}

/** Look up one harness's catalog in the map returned by `useModelsForHarnesses`. */
export function modelsForHarness<T>(
  catalogs: ReadonlyMap<string, T | undefined>,
  harnessID: string | undefined
): T | undefined {
  return catalogs.get(harnessKey(harnessID))
}

export function useProviders(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.providers(target),
    queryFn: () => client!.provider.list({ harnessID: target! }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useCommands(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.commands(target),
    queryFn: () => client!.command.list({ harnessID: target! }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useSkills(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.skills(directory, target),
    queryFn: () => client!.skill.list({ harnessID: target!, location: { directory } }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useReferences(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.references(directory, target),
    queryFn: () => client!.reference.list({ harnessID: target!, location: { directory } }),
    enabled: Boolean(client && target),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}
