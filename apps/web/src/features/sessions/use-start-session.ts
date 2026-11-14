import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import type { ClaraProjectWorkspace } from '@clara/api-contract'
import { resolveDefaultAgent } from '@/features/agents/default-agent'
import { useDefaultAgent } from '@/features/agents/use-default-agent'
import { useAgents } from '@/features/catalog/use-catalog'
import type { PromptFile } from '@/features/chat/use-chat'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import { resolveInheritedModel } from '@/features/models/visibility'
import { useSessionPolicy } from '@/features/notifications/session-policy'
import { isWorkspaceStartable } from '@/features/projects/project-workspaces'
import { latestSessionInWorkspace } from '@/features/sessions/session-workspace'
import {
  useCreateSession,
  useSessions,
  type CreateSessionInput,
} from '@/features/sessions/use-sessions'
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
}: {
  projectID: string | undefined
  workspace: ClaraProjectWorkspace | null | undefined
  /** Latest session's agent, used when no default has been chosen yet. */
  agent?: CreateSessionInput['agent']
}) {
  const navigate = useNavigate()
  const createSession = useCreateSession()
  const { settings, lastAgent } = useDefaultAgent()
  const agentsQuery = useAgents(workspace?.harnessID)
  const { visibility } = useModelVisibility()
  const { isAutomation } = useSessionPolicy()
  const sessionsQuery = useSessions(projectID ?? null, '', Boolean(projectID && workspace))

  const resolvedAgent = resolveDefaultAgent({
    settings,
    lastAgent,
    fallbackAgent: agent,
    agents: agentsQuery.data,
  })

  /**
   * A model belongs to the harness and workspace that saved it. A new brief in
   * another workspace must not inherit a model from a different harness or
   * machine, so an unknown pair starts on the harness default.
   */
  const modelForWorkspace = useCallback(
    (target: ClaraProjectWorkspace) => {
      const latest = latestSessionInWorkspace(sessionsQuery.data?.data ?? [], target, {
        exclude: (session) => isAutomation?.(session) === true,
      })
      return resolveInheritedModel(latest?.model, visibility)
    },
    [isAutomation, sessionsQuery.data?.data, visibility]
  )

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
          model: modelForWorkspace(target),
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
    [createSession, modelForWorkspace, navigate, projectID, resolvedAgent, workspace]
  )

  return { startSession, pending: createSession.isPending }
}
