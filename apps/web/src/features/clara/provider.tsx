import { useCallback, type ReactNode } from 'react'
import type { SessionInfo } from '@opencode/client'
import { isClaraWorkerTitle } from '@clara/shared-types'
import { SessionPolicyProvider } from '@/features/notifications/session-policy'
import { useConnection } from '@/providers/connection-provider'
import { useClaraAgentRefresh } from './agent-refresh'
import { ClaraNotificationBridge } from './notifications'

/**
 * Mounts every web-side Clara behaviour inside one boundary. When the build
 * excludes the feature this provider is not rendered and none of the bridge
 * hooks run.
 */
export function ClaraFeatureProvider({ children }: { children: ReactNode }) {
  const { relayStatus } = useConnection()
  const management = relayStatus?.agent?.management === true
  useClaraAgentRefresh()

  const suppressSession = useCallback(
    (session: SessionInfo) => management && isClaraWorkerTitle(session.title),
    [management]
  )

  return (
    <SessionPolicyProvider suppressSession={suppressSession}>
      <ClaraNotificationBridge />
      {children}
    </SessionPolicyProvider>
  )
}
