import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useCreateSession, type CreateSessionInput } from '@/features/sessions/use-sessions'

export type ChatComposeState = { compose?: boolean }

export function useStartSession({
  projectID,
  directory,
  agent,
  model,
}: {
  projectID: string | undefined
  directory: string | undefined
  agent?: CreateSessionInput['agent']
  model?: CreateSessionInput['model']
}) {
  const navigate = useNavigate()
  const createSession = useCreateSession(directory ?? '')

  const startSession = useCallback(() => {
    if (!projectID || !directory) return
    createSession.mutate(
      { agent, model },
      {
        onSuccess: (session) => {
          const state: ChatComposeState = { compose: true }
          navigate(`/p/${projectID}/s/${session.id}`, { state })
        },
      }
    )
  }, [agent, createSession, directory, model, navigate, projectID])

  return { startSession, pending: createSession.isPending }
}
