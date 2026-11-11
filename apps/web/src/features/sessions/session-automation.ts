import type { ClaraSession } from '@clara/api-contract'

/**
 * A session created by an automation source rather than a person. Clara writes
 * this marker when the daemon launches a worker stage.
 */
export function isAutomationSession(session: Pick<ClaraSession, 'metadata'>): boolean {
  return session.metadata?.automation === true
}
