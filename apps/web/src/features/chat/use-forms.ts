import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unsnoozeSessionOnEngage } from '@/features/sessions/unsnooze'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type FormAnswerValue = string | number | boolean | string[]

export function useSessionForms(sessionID: string) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.forms(sessionID),
    queryFn: () => client!.session.form.list({ sessionID }),
    enabled: Boolean(client && sessionID),
    refetchInterval: 15_000,
  })
}

export function useReplyForm(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { formID: string; answer: Record<string, FormAnswerValue> }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      return client!.session.form.reply({
        sessionID,
        formID: input.formID,
        answer: input.answer,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.forms(sessionID) })
    },
  })
}

export function useRejectForm(sessionID: string) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { formID: string; message?: string }) => {
      await unsnoozeSessionOnEngage(client!, queryClient, sessionID)
      return client!.session.form.cancel({
        sessionID,
        formID: input.formID,
        message: input.message,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.forms(sessionID) })
    },
  })
}
