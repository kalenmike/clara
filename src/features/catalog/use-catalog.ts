import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useAgents() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => client!.agent.list(),
    enabled: Boolean(client),
    select: (result) => result.data,
  })
}

export function useModels() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => client!.model.list(),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useCommands() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.commands,
    queryFn: () => client!.command.list(),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useSkills(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: ['skills', directory ?? 'global'],
    queryFn: () => client!.skill.list({ location: { directory } }),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}

export function useReferences(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.references(directory),
    queryFn: () => client!.reference.list({ location: { directory } }),
    enabled: Boolean(client),
    select: (result) => result.data,
    staleTime: 60_000,
  })
}
