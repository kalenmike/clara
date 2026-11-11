import { useCallback, useMemo, type ReactNode } from 'react'
import type { ClaraSession } from '@clara/api-contract'
import { SessionPolicyProvider } from '@/features/notifications/session-policy'
import { isAutomationSession } from '@/features/sessions/session-automation'
import { useConnection } from '@/providers/connection-provider'

/**
 * Mounts the orchestration session policy. Automation sessions are grouped and
 * kept quiet only while the orchestrator reports that it is reachable.
 */
export function OrchestrationProvider({ children }: { children: ReactNode }) {
  const { relayStatus } = useConnection()
  const orchestration = relayStatus?.agent?.orchestration === true

  const suppressSession = useCallback(
    (session: ClaraSession) => orchestration && isAutomationSession(session),
    [orchestration]
  )
  const isAutomation = useMemo(
    () => (orchestration ? isAutomationSession : undefined),
    [orchestration]
  )

  return (
    <SessionPolicyProvider suppressSession={suppressSession} isAutomation={isAutomation}>
      {children}
    </SessionPolicyProvider>
  )
}
