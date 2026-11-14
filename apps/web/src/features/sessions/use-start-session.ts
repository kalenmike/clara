import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import type { ClaraProjectWorkspace } from '@clara/api-contract'
import { resolveDefaultAgent } from '@/features/agents/default-agent'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents } from '@/features/catalog/use-catalog'
import type { PromptFile } from '@/features/chat/use-chat'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { resolveInheritedModel } from '@/features/models/visibility'
import { isWorkspaceStartable } from '@/features/projects/project-workspaces'
import { useCreateSession, type CreateSessionInput } from '@/features/sessions/use-sessions'
import { saveLastWorkspace } from '@/lib/storage'

export type ChatComposeState = {
  compose?: boolean
  draftText?: string
  draftFiles?: PromptFile[]
}

export function useStartSession({
  projectID,
  workspace,
  agent,
  model,
}: {
  projectID: string | undefined
  workspace: ClaraProjectWorkspace | null | undefined
  /** Latest session's agent, used when no default has been chosen yet. */
  agent?: CreateSessionInput['agent']
  model?: CreateSessionInput['model']
}) {
  const navigate = useNavigate()
  const createSession = useCreateSession()
  const { settings, lastAgent } = useDefaultAgent()
  const agentsQuery = useAgents(workspace?.harnessID)
  const { visibility } = useModelVisibility()

  const resolvedAgent = resolveDefaultAgent({
    settings,
    lastAgent,
    fallbackAgent: agent,
    agents: agentsQuery.data,
  })
  const resolvedModel = resolveInheritedModel(model, visibility)

  const startSession = useCallback(
    (nextWorkspace?: ClaraProjectWorkspace) => {
      const target = nextWorkspace ?? workspace
      const directory = target?.canonical ?? target?.directory
      if (!projectID || !target || !directory) return
      if (!isWorkspaceStartable(target)) return
      createSession.mutate(
        {
          directory,
          harnessID: target.harnessID,
          agent: resolvedAgent,
          model: resolvedModel,
        },
        {
          onSuccess: (session) => {
            saveLastWorkspace(projectID, target.id)
            const state: ChatComposeState = { compose: true }
            navigate(`/p/${projectID}/s/${session.id}`, { state })
          },
        }
      )
    },
    [createSession, navigate, projectID, resolvedAgent, resolvedModel, workspace]
  )

  return { startSession, pending: createSession.isPending }
}
