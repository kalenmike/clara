import { useMemo } from 'react'
import type { ClaraSession, ClaraSessionMessage } from '@clara/api-contract'
import { SessionPlan } from '@/components/layout/session-plan'
import { findPlanTodos } from '@/features/chat/session-plan'
import { useSessionContext } from '@/features/chat/use-session-context'

export function SessionPlanDock({
  session,
  messages,
  draft,
  busy,
}: {
  session: ClaraSession | undefined
  messages: ClaraSessionMessage[]
  draft: boolean
  busy: boolean
}) {
  const sessionID = session?.id ?? ''
  const contextQuery = useSessionContext(sessionID, Boolean(session))
  const forkedAt = session?.fork ? session.time.created : undefined
  const todos = useMemo(
    () =>
      findPlanTodos(messages, { forkedAt }) ?? findPlanTodos(contextQuery.data ?? [], { forkedAt }),
    [contextQuery.data, forkedAt, messages]
  )

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-t">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
        <SessionPlan
          key={sessionID}
          sessionID={sessionID}
          todos={todos}
          messages={messages}
          draft={draft}
          busy={busy}
        />
      </div>
    </div>
  )
}
