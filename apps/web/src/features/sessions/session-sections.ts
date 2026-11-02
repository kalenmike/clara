import type { SessionInfo } from '@opencode/client'
import { isArchivedSession } from '@/features/sessions/session-archive'
import {
  resolveSessionMailbox,
  type SessionMailboxSignals,
} from '@/features/sessions/session-mailbox'
import { isSnoozedSession } from '@/features/sessions/session-snooze'

export type SessionGroups = {
  inbox: SessionInfo[]
  outbox: SessionInfo[]
  drafts: SessionInfo[]
  snoozed: SessionInfo[]
  archived: SessionInfo[]
  workers: SessionInfo[]
}

/** Split sessions into the sidebar's mailbox sections, newest first. */
export function groupSessionsByMailbox(
  sessions: SessionInfo[],
  signals: ReadonlyMap<string, SessionMailboxSignals>,
  running: Readonly<Record<string, unknown>> | undefined,
  awaitingInput: ReadonlySet<string>,
  isAutomation?: (session: SessionInfo) => boolean
): SessionGroups {
  const inbox: SessionInfo[] = []
  const outbox: SessionInfo[] = []
  const drafts: SessionInfo[] = []
  const snoozed: SessionInfo[] = []
  const archived: SessionInfo[] = []
  const workers: SessionInfo[] = []

  for (const session of sessions) {
    if (isAutomation?.(session)) {
      workers.push(session)
      continue
    }
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

  const byUpdated = (a: SessionInfo, b: SessionInfo) => b.time.updated - a.time.updated
  inbox.sort(byUpdated)
  outbox.sort(byUpdated)
  drafts.sort(byUpdated)
  snoozed.sort(byUpdated)
  archived.sort((a, b) => (b.time.archived ?? b.time.updated) - (a.time.archived ?? a.time.updated))
  workers.sort(byUpdated)

  return { inbox, outbox, drafts, snoozed, archived, workers }
}
