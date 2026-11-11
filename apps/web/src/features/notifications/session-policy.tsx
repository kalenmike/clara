/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ClaraSession } from '@clara/api-contract'

type SessionPolicy = {
  /** Return true to keep a generic session alert quiet. */
  suppressSession?: (session: ClaraSession) => boolean
  /** Present only while orchestration is reachable. */
  isAutomation?: (session: ClaraSession) => boolean
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
  suppressSession?: (session: ClaraSession) => boolean
  isAutomation?: (session: ClaraSession) => boolean
  children: ReactNode
}) {
  const value = useMemo(() => ({ suppressSession, isAutomation }), [suppressSession, isAutomation])
  return <SessionPolicyContext.Provider value={value}>{children}</SessionPolicyContext.Provider>
}

export function useSessionPolicy(): SessionPolicy {
  return useContext(SessionPolicyContext)
}
