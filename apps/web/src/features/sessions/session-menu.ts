import type { ClaraSession } from '@clara/api-contract'
import { isArchivedSession } from './session-archive'
import { isSnoozedSession } from './session-snooze'
import type { SessionWording } from './wording'

export type SessionMenuAction = 'snooze' | 'unsnooze' | 'archive' | 'reopen' | 'delete'

export type SessionMenuEntry = {
  action: SessionMenuAction
  label: string
  destructive?: boolean
}

/**
 * The session row's context menu mirrors the chat header's more menu: snooze is
 * hidden once a session is archived, and an archived row reopens instead.
 */
export function sessionMenuEntries(
  session: ClaraSession,
  wording: Pick<SessionWording, 'lowerSingular'>
): SessionMenuEntry[] {
  const archived = isArchivedSession(session)
  const snoozed = isSnoozedSession(session)
  const noun = wording.lowerSingular
  const entries: SessionMenuEntry[] = []

  if (!archived) {
    entries.push(
      snoozed
        ? { action: 'unsnooze', label: 'Remove from Snoozed' }
        : { action: 'snooze', label: `Snooze ${noun}` }
    )
  }

  entries.push(
    archived
      ? { action: 'reopen', label: `Reopen ${noun}` }
      : { action: 'archive', label: `Archive ${noun}` }
  )

  entries.push({ action: 'delete', label: `Delete ${noun}`, destructive: true })

  return entries
}
