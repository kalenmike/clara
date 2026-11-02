import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SessionInfo } from '@opencode/client'

type SessionPolicy = {
  /** Return true to keep a generic session alert quiet. */
  suppressSession?: (session: SessionInfo) => boolean
}

const SessionPolicyContext = createContext<SessionPolicy>({})

/**
 * A feature-neutral hook for optional session-alert suppression. Clara
 * management supplies its worker-session predicate from the feature module;
 * the notification provider never imports Clara code.
 */
export function SessionPolicyProvider({
  suppressSession,
  children,
}: {
  suppressSession?: (session: SessionInfo) => boolean
  children: ReactNode
}) {
  const value = useMemo(() => ({ suppressSession }), [suppressSession])
  return <SessionPolicyContext.Provider value={value}>{children}</SessionPolicyContext.Provider>
}

export function useSessionPolicy(): SessionPolicy {
  return useContext(SessionPolicyContext)
}
