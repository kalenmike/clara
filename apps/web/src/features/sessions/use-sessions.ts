import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClaraSession } from '@clara/api-contract'
import {
  isSnoozedSession,
  snoozeMetadata,
  unsnoozeMetadata,
} from '@/features/sessions/session-snooze'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useSessions(projectID: string | null, search: string, enabled = true) {
  const { client } = useConnection()
  return useQuery({
    queryKey: [...queryKeys.sessions(projectID), search],
    queryFn: () =>
      client!.session.list({
        project: projectID ?? undefined,
        search: search.trim() || undefined,
        archived: false,
        limit: 50,
      }),
    enabled: Boolean(client) && enabled,
  })
}

export function useArchivedSessions(projectID: string | null, search: string, enabled = true) {
  const { client } = useConnection()
  return useQuery({
    queryKey: [...queryKeys.archivedSessions(projectID), search],
    queryFn: () =>
      client!.session.list({
        project: projectID ?? undefined,
        search: search.trim() || undefined,
        archived: true,
        limit: 50,
      }),
    enabled: Boolean(client) && enabled,
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
  /** Routes creation to a paired harness; the hub strips it before forwarding. */
  harnessID?: string
}

export function useCreateSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSessionInput & { directory: string }) =>
      client!.session.create({
        title: input.title || undefined,
        agent: input.agent,
        model: input.model,
        harnessID: input.harnessID,
        location: { directory: input.directory },
      }),
    onSuccess: (session: ClaraSession) => {
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    },
  })
}

export function useSnoozeSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ session, snoozed }: { session: ClaraSession; snoozed: boolean }) =>
      client!.session.update({
        sessionID: session.id,
        metadata: snoozed ? snoozeMetadata(session.metadata) : unsnoozeMetadata(session.metadata),
      }),
    onSuccess: (_result, { session }) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
    },
  })
}

/** Reopen a session, clearing its archived flag and any snooze metadata. */
export function useReopenSession() {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ session }: { session: ClaraSession }) =>
      client!.session.update({
        sessionID: session.id,
        archived: false,
        ...(isSnoozedSession(session) ? { metadata: unsnoozeMetadata(session.metadata) } : {}),
      }),
    onSuccess: (_result, { session }) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
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
