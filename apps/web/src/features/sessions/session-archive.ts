import type { ClaraSession } from '@clara/api-contract'

/** A session is archived only when the server says so; titles never decide it. */
export function isArchivedSession(session: ClaraSession): boolean {
  return session.time.archived != null
}
