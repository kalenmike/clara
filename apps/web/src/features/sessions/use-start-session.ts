import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { resolveDefaultAgent } from '@/features/agents/default-agent'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents } from '@/features/catalog/use-catalog'
import type { PromptFile } from '@/features/chat/use-chat'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { resolveInheritedModel } from '@/features/models/visibility'
import { useCreateSession, type CreateSessionInput } from '@/features/sessions/use-sessions'

export type ChatComposeState = {
  compose?: boolean
  draftText?: string
  draftFiles?: PromptFile[]
}

export function useStartSession({
  projectID,
  directory,
  agent,
  model,
}: {
  projectID: string | undefined
  directory: string | undefined
  /** Latest session's agent, used when no default has been chosen yet. */
  agent?: CreateSessionInput['agent']
  model?: CreateSessionInput['model']
}) {
  const navigate = useNavigate()
  const createSession = useCreateSession(directory ?? '')
  const { settings, lastAgent } = useDefaultAgent()
  const agentsQuery = useAgents()
  const { visibility } = useModelVisibility()

  const resolvedAgent = resolveDefaultAgent({
    settings,
    lastAgent,
    fallbackAgent: agent,
    agents: agentsQuery.data,
  })
  const resolvedModel = resolveInheritedModel(model, visibility)

  const startSession = useCallback(() => {
    if (!projectID || !directory) return
    createSession.mutate(
      { agent: resolvedAgent, model: resolvedModel },
      {
        onSuccess: (session) => {
          const state: ChatComposeState = { compose: true }
          navigate(`/p/${projectID}/s/${session.id}`, { state })
        },
      }
    )
  }, [createSession, directory, navigate, projectID, resolvedAgent, resolvedModel])

  return { startSession, pending: createSession.isPending }
}
