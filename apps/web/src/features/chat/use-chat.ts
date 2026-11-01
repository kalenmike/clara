import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JsonValue, SessionMessageInfo } from '@opencode/client'
import { toast } from 'sonner'
export type PromptFile = {
  uri: string
  name?: string
  description?: string
}
import { saveLastAgent } from '@/features/agents/default-agent'
import { chatStore, type ChatSnapshot } from '@/features/chat/chat-store'
import { unsnoozeSessionOnEngage } from '@/features/sessions/unsnooze'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

/** The server rejects page sizes above 100. */
const MESSAGE_PAGE_SIZE = 100

type SessionMessagesPage = {
  messages: SessionMessageInfo[]
  nextCursor: string | null
}

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
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loading = useRef<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.messages(sessionID),
    queryFn: async (): Promise<SessionMessagesPage> => {
      const result = await client!.message.list({
        sessionID,
        order: 'desc',
        limit: MESSAGE_PAGE_SIZE,
      })
      return {
        messages: [...result.data].reverse(),
        nextCursor: result.data.length >= MESSAGE_PAGE_SIZE ? (result.cursor.next ?? null) : null,
      }
    },
    enabled: Boolean(client && sessionID),
  })

  useEffect(() => {
    if (!query.data) return
    chatStore.hydrate(sessionID, query.data.messages, query.data.nextCursor)
  }, [query.data, sessionID])

  useEffect(() => {
    loading.current = null
    setLoadingOlder(false)
  }, [sessionID])

  const loadOlder = useCallback(async () => {
    if (!client || loading.current === sessionID) return
    const { cursor, generation } = chatStore.getOlderPage(sessionID)
    if (!cursor) return

    loading.current = sessionID
    setLoadingOlder(true)
    try {
      const result = await client.message.list({
        sessionID,
        cursor,
        limit: MESSAGE_PAGE_SIZE,
      })
      chatStore.prependOlder(
        sessionID,
        [...result.data].reverse(),
        result.data.length >= MESSAGE_PAGE_SIZE ? (result.cursor.next ?? null) : null,
        generation
      )
    } catch {
      toast.error('Could not load earlier messages')
    } finally {
      if (loading.current === sessionID) {
        loading.current = null
        setLoadingOlder(false)
      }
    }
  }, [client, sessionID])

  return { ...query, loadOlder, loadingOlder }
}

export function useSessionInbox(sessionID: string) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.sessionInbox(sessionID),
    queryFn: () => client!.session.inbox.list({ sessionID }),
    enabled: Boolean(client && sessionID),
  })
}

export function useSendPrompt(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      text: string
      files?: PromptFile[]
      delivery?: 'steer' | 'queue'
    }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      return client!.session.prompt({
        sessionID,
        text: input.text,
        files: input.files,
        delivery: input.delivery,
      })
    },
    onSuccess: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionInbox(sessionID) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMailbox(sessionID) })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }, 200)
    },
  })
}

/**
 * Record a non-user input that may start or steer the agent. Synthetic input
 * keeps the transcript free of fake user prompts while still reaching the
 * model, and `description` is a free UI label that is never sent to the model.
 */
export function useSendSynthetic(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      text: string
      description?: string
      metadata?: Record<string, JsonValue>
      delivery?: 'steer' | 'queue'
      resume?: boolean
    }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      return client!.session.synthetic({
        sessionID,
        text: input.text,
        description: input.description,
        metadata: input.metadata,
        delivery: input.delivery,
        resume: input.resume,
      })
    },
    onSuccess: () => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionInbox(sessionID) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMailbox(sessionID) })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }, 200)
    },
  })
}

export function useSaveDraft(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { text: string; files?: PromptFile[]; title?: string }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      await client!.session.prompt({
        sessionID,
        text: input.text,
        files: input.files,
        resume: false,
      })

      let titleUpdated = true
      if (input.title) {
        try {
          await client!.session.update({ sessionID, title: input.title })
        } catch {
          titleUpdated = false
        }
      }

      return { titleUpdated }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionInbox(sessionID) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionMailbox(sessionID) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

export function useRunCommand(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; text: string; files?: PromptFile[] }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      return client!.session.command({
        sessionID,
        name: input.name,
        text: input.text,
        files: input.files,
      })
    },
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
    onSuccess: (_data, agent) => {
      saveLastAgent(agent)
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
