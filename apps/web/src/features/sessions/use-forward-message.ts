import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SessionInfo, SessionMessageInfo } from '@opencode/client'
import { toast } from 'sonner'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { resolveInheritedModel } from '@/features/models/visibility'
import {
  forwardFiles,
  forwardText,
  forwardTitle,
  forwardTitleFromText,
} from '@/features/sessions/forward'
import type { ChatComposeState } from '@/features/sessions/use-start-session'
import { useSessionWording } from '@/features/sessions/use-wording'
import { queryKeys } from '@/lib/query-keys'
import { saveDraft } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'

type SessionTarget = {
  session: SessionInfo | undefined
  projectID: string | undefined
}

type ForwardInput = {
  message: SessionMessageInfo
  /** A selected slice of the reply. When present it replaces the whole message. */
  text?: string
}

/**
 * Create an empty draft and hand the forwarded message to the reply window as
 * editable text. Nothing reaches the server until the person sends it.
 */
export function useForwardMessage({ session, projectID }: SessionTarget) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { lowerSingular } = useSessionWording()
  const { visibility } = useModelVisibility()

  return useMutation({
    mutationFn: async ({ message, text: selected }: ForwardInput) => {
      if (!session || !client) throw new Error('No session to forward from')

      const selection = selected?.trim() ?? ''
      const text = selection || forwardText(message)
      const files = selection ? [] : forwardFiles(message)
      if (text.trim().length === 0 && files.length === 0) {
        throw new Error('This message has nothing to forward')
      }

      const created = await client.session.create({
        title: selection ? forwardTitleFromText(selection) : forwardTitle(message),
        agent: session.agent,
        model: resolveInheritedModel(session.model, visibility),
        location: { directory: session.location.directory },
      })
      saveDraft(created.id, text)

      return { created, text, files }
    },
    onSuccess: ({ created, text, files }) => {
      queryClient.setQueryData(queryKeys.session(created.id), created)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })

      const targetProject = projectID ?? session?.projectID
      if (!targetProject) return

      const state: ChatComposeState = {
        compose: true,
        draftText: text,
        draftFiles: files,
      }
      navigate(`/p/${targetProject}/s/${created.id}`, { state })
    },
    onError: () => {
      toast.error(`Could not forward the message to a new ${lowerSingular}`)
    },
  })
}
