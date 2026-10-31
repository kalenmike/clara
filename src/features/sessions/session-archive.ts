import type { SessionInfo } from '@opencode/client'

/** A session is archived only when the server says so; titles never decide it. */
export function isArchivedSession(session: SessionInfo): boolean {
  return session.time.archived != null
}
