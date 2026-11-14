import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ClaraModel } from '@clara/api-contract'
import {
  harnessLocation,
  resolveHarnessID,
  useHarnessScope,
} from '@/features/harness/harness-scope'
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
    queryFn: () => client!.agent.list(harnessLocation(undefined, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
  })
}

export function useModels(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.models(target),
    queryFn: () => client!.model.list(harnessLocation(undefined, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

/**
 * Model catalogs for several harnesses at once. Sessions page cost estimates
 * need each session's own prices, and every harness prices its models itself.
 * An undefined entry resolves the active/default harness.
 */
export function useModelsForHarnesses(harnessIDs: readonly (string | undefined)[]) {
  const { client } = useConnection()
  const targets = useMemo(() => {
    const seen = new Set<string>()
    const next: (string | undefined)[] = []
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
      queryFn: () => client!.model.list(harnessLocation(undefined, harnessID)),
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
    queryFn: () => client!.provider.list(harnessLocation(undefined, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useCommands(harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.commands(target),
    queryFn: () => client!.command.list(harnessLocation(undefined, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useSkills(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.skills(directory, target),
    queryFn: () => client!.skill.list(harnessLocation(directory, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useReferences(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const target = useCatalogHarness(harnessID)
  return useQuery({
    queryKey: queryKeys.references(directory, target),
    queryFn: () => client!.reference.list(harnessLocation(directory, target)),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}
