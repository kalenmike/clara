import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useSessions(directory: string | null, search: string) {
  const { client } = useConnection()
  return useQuery({
    queryKey: [...queryKeys.sessions(directory), search],
    queryFn: () =>
      client!.session.list({
        directory: directory ?? undefined,
        search: search.trim() || undefined,
        limit: 50,
      }),
    enabled: Boolean(client),
  })
}

export function useSession(sessionID: string | null) {
  const { client } = useConnection()
  return useQuery({
    queryKey: sessionID ? queryKeys.session(sessionID) : ['session', 'none'],
    queryFn: () => client!.session.get({ sessionID: sessionID! }),
    enabled: Boolean(client && sessionID),
  })
}

export function useActiveSessions() {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.activeSessions,
    queryFn: () => client!.session.active(),
    enabled: Boolean(client),
    refetchInterval: 10_000,
  })
}

export type CreateSessionInput = {
  title?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
}

export function useCreateSession(directory: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSessionInput = {}) =>
      client!.session.create({
        title: input.title || undefined,
        agent: input.agent,
        model: input.model,
        location: { directory },
      }),
    onSuccess: (session: SessionInfo) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.setQueryData(queryKeys.session(session.id), session)
    },
  })
}

export function useRenameSession(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => client!.session.update({ sessionID, title }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    },
  })
}

export function useArchiveSession(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (archived: boolean) => client!.session.update({ sessionID, archived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

export function useDeleteSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionID: string) => client!.session.remove({ sessionID }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}
