import type { SessionInfo, SessionMetadata } from '@opencode/client'

const SNOOZE_KEY = 'snoozed'

/** A session is snoozed only when the server metadata says so. */
export function isSnoozedSession(session: SessionInfo): boolean {
  return session.metadata?.[SNOOZE_KEY] === true
}

/** Mark a session snoozed without dropping metadata written by other clients. */
export function snoozeMetadata(metadata: SessionMetadata | undefined): SessionMetadata {
  return { ...(metadata ?? {}), [SNOOZE_KEY]: true }
}

/**
 * Remove the snooze marker. The server replaces session metadata wholesale, so
 * returning the remaining keys deletes the snoozed entry without touching
 * metadata written by other clients.
 */
export function unsnoozeMetadata(metadata: SessionMetadata | undefined): SessionMetadata {
  const next: SessionMetadata = { ...(metadata ?? {}) }
  delete next[SNOOZE_KEY]
  return next
}
