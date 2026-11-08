/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SessionInfo } from '@opencode/client'

type SessionPolicy = {
  /** Return true to keep a generic session alert quiet. */
  suppressSession?: (session: SessionInfo) => boolean
  /** Present only while orchestration is reachable. */
  isAutomation?: (session: SessionInfo) => boolean
}

const SessionPolicyContext = createContext<SessionPolicy>({})

/**
 * A feature-neutral hook for optional session policy. The orchestration
 * provider supplies worker-session predicates; core session management never
 * imports orchestration code.
 */
export function SessionPolicyProvider({
  suppressSession,
  isAutomation,
  children,
}: {
  suppressSession?: (session: SessionInfo) => boolean
  isAutomation?: (session: SessionInfo) => boolean
  children: ReactNode
}) {
  const value = useMemo(() => ({ suppressSession, isAutomation }), [suppressSession, isAutomation])
  return <SessionPolicyContext.Provider value={value}>{children}</SessionPolicyContext.Provider>
}

export function useSessionPolicy(): SessionPolicy {
  return useContext(SessionPolicyContext)
}
