import type { ClaraSession } from '@clara/api-contract'
import { resolveSessionMailbox, type SessionMailboxSignals } from '@clara/shared-types'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'

export type SessionGroups = {
  inbox: ClaraSession[]
  outbox: ClaraSession[]
  drafts: ClaraSession[]
  snoozed: ClaraSession[]
  archived: ClaraSession[]
}

/**
 * Merge the active and archived session lists, keeping the archived copy when
 * both lists return the same session.
 */
export function mergeSessionLists(
  sessions: ClaraSession[],
  archivedSessions: ClaraSession[]
): ClaraSession[] {
  const byID = new Map<string, ClaraSession>()
  for (const session of archivedSessions) byID.set(session.id, session)
  for (const session of sessions) {
    if (!byID.has(session.id)) byID.set(session.id, session)
  }
  return [...byID.values()]
}

/** Flatten cursor pages, keeping the first copy of a session that repeats. */
export function mergeSessionPages(pages: readonly (readonly ClaraSession[])[]): ClaraSession[] {
  const byID = new Map<string, ClaraSession>()
  for (const page of pages) {
    for (const session of page) {
      if (!byID.has(session.id)) byID.set(session.id, session)
    }
  }
  return [...byID.values()]
}

/** Split sessions into the sidebar's mailbox sections, newest first. */
export function groupSessionsByMailbox(
  sessions: ClaraSession[],
  signals: ReadonlyMap<string, SessionMailboxSignals>,
  running: Readonly<Record<string, unknown>> | undefined,
  awaitingInput: ReadonlySet<string>
): SessionGroups {
  const inbox: ClaraSession[] = []
  const outbox: ClaraSession[] = []
  const drafts: ClaraSession[] = []
  const snoozed: ClaraSession[] = []
  const archived: ClaraSession[] = []

  for (const session of sessions) {
    if (isArchivedSession(session)) {
      archived.push(session)
      continue
    }
    if (isSnoozedSession(session)) {
      snoozed.push(session)
      continue
    }
    const mailbox = resolveSessionMailbox(signals.get(session.id), {
      running: Boolean(running?.[session.id]),
      awaitingInput: awaitingInput.has(session.id),
    })
    if (mailbox === 'outbox') outbox.push(session)
    else if (mailbox === 'draft') drafts.push(session)
    else inbox.push(session)
  }

  const byUpdated = (a: ClaraSession, b: ClaraSession) => b.time.updated - a.time.updated
  inbox.sort(byUpdated)
  outbox.sort(byUpdated)
  drafts.sort(byUpdated)
  snoozed.sort(byUpdated)
  archived.sort((a, b) => (b.time.archived ?? b.time.updated) - (a.time.archived ?? a.time.updated))

  return { inbox, outbox, drafts, snoozed, archived }
}
