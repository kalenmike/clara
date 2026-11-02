import type { SessionInfo } from '@opencode/client'

/**
 * A session created by an automation source rather than a person. Clara writes
 * this marker when the daemon launches a worker stage.
 */
export function isAutomationSession(session: Pick<SessionInfo, 'metadata'>): boolean {
  return session.metadata?.automation === true
}
