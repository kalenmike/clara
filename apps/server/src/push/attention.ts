import {
  assistantHasFailed,
  isFinishedPlanReply,
  resolveAttentionKind,
  type AttentionKind,
  type SessionMailboxSignals,
} from '@clara/shared-types'
import type { SessionInfo } from '@opencode/client'
import type { HarnessRequest } from '../harness/types.ts'
import { getSession, listForms, listRecentMessages } from './opencode.ts'

export type SessionAttention = {
  kind: AttentionKind
  session: SessionInfo
}

export function isArchivedSession(session: SessionInfo): boolean {
  return session.time.archived != null
}

export function isSnoozedSession(session: SessionInfo): boolean {
  return session.metadata?.snoozed === true
}

/**
 * The agent mirrors the web's mailbox signals so a push and the sidebar agree
 * on why a session needs the person.
 */
export async function loadSessionSignals(
  client: HarnessRequest,
  sessionID: string
): Promise<SessionMailboxSignals> {
  const [users, assistants, forms] = await Promise.all([
    listRecentMessages(client, sessionID, 'user'),
    listRecentMessages(client, sessionID, 'assistant'),
    listForms(client, sessionID),
  ])

  const lastUser = users[0]
  const lastAssistant = assistants[0]
  const last: SessionMailboxSignals['last'] =
    !lastUser && !lastAssistant
      ? 'none'
      : lastAssistant && (!lastUser || lastAssistant.time.created >= lastUser.time.created)
        ? 'assistant'
        : 'user'

  const assistantLast =
    last === 'assistant' && lastAssistant?.type === 'assistant' ? lastAssistant : undefined

  return {
    last,
    awaitingInput: forms.length > 0,
    lastError: Boolean(assistantLast && assistantHasFailed(assistantLast)),
    planReply: Boolean(assistantLast && isFinishedPlanReply(assistantLast)),
  }
}

export async function loadSessionAttention(
  client: HarnessRequest,
  sessionID: string
): Promise<SessionAttention | null> {
  const session = await getSession(client, sessionID)
  if (!session || isArchivedSession(session) || isSnoozedSession(session)) return null

  const signals = await loadSessionSignals(client, sessionID)
  const kind = resolveAttentionKind(signals, session.agent, false)
  return kind ? { kind, session } : null
}
