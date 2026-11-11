import type { ClaraSession } from '@clara/api-contract'

/**
 * A session is unread when its newest completed turn has not been viewed.
 * OpenCode records the idle transition timestamp and advances `viewed` when a
 * client reports that it saw that transition.
 */
export function isSessionUnread(session: Pick<ClaraSession, 'time'>): boolean {
  const { idle, viewed } = session.time
  return idle !== undefined && (viewed === undefined || idle > viewed)
}
