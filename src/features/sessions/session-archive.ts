import type { SessionInfo } from '@opencode/client'

const DONE_SUFFIX = /(?:\[DONE\]|\(DONE\))\s*$/i

/** Append the canonical `[DONE]` marker without duplicating an existing suffix. */
export function appendDoneSuffix(title: string | undefined): string {
  const trimmed = title?.trimEnd() ?? ''
  if (!trimmed) return '[DONE]'
  if (DONE_SUFFIX.test(trimmed)) return trimmed
  return `${trimmed} [DONE]`
}

/** A session is archived only when the server says so; titles never decide it. */
export function isArchivedSession(session: SessionInfo): boolean {
  return session.time.archived != null
}
