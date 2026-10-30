import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
export type PromptFile = {
  uri: string
  name?: string
  description?: string
}
import { chatStore, type ChatSnapshot } from '@/features/chat/chat-store'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export function useChatSnapshot(sessionID: string): ChatSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => chatStore.subscribe(sessionID, listener),
    [sessionID]
  )
  const getSnapshot = useCallback(() => chatStore.getSnapshot(sessionID), [sessionID])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSessionMessages(sessionID: string) {
  const { client } = useConnection()
  const query = useQuery({
    queryKey: queryKeys.messages(sessionID),
    queryFn: async () => {
      const result = await client!.message.list({ sessionID, order: 'desc', limit: 100 })
      return { ...result, data: [...result.data].reverse() }
    },
    enabled: Boolean(client && sessionID),
  })

  useEffect(() => {
    if (!query.data) return
    chatStore.hydrate(sessionID, query.data.data)
  }, [query.data, sessionID])

  return query
}

export function useSendPrompt(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { text: string; files?: PromptFile[]; delivery?: 'steer' | 'queue' }) =>
      client!.session.prompt({
        sessionID,
        text: input.text,
        files: input.files,
        delivery: input.delivery,
      }),
    onSuccess: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }, 200)
    },
  })
}

export function useRunCommand(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { name: string; text: string; files?: PromptFile[] }) =>
      client!.session.command({
        sessionID,
        name: input.name,
        text: input.text,
        files: input.files,
      }),
    onSuccess: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
      }, 250)
    },
  })
}

export function useInterruptSession(sessionID: string) {
  const { client } = useConnection()
  return useMutation({
    mutationFn: () => client!.session.interrupt({ sessionID }),
  })
}

export function useSwitchAgent(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agent: string) => client!.session.switchAgent({ sessionID, agent }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    },
  })
}

export function useSwitchModel(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (model: { id: string; providerID: string; variant?: string }) =>
      client!.session.switchModel({ sessionID, model }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    },
  })
}

export function useCompactSession(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => client!.session.compact({ sessionID }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
    },
  })
}
