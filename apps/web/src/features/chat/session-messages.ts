import type { SessionInboxUser, SessionMessageInfo, SessionMessageUser } from '@opencode/client'

export function inboxDraftToMessage(item: SessionInboxUser): SessionMessageUser {
  return {
    id: item.id,
    metadata: item.payload.metadata,
    time: item.time,
    text: item.payload.text,
    files: item.payload.files,
    agents: item.payload.agents,
    skills: item.payload.skills,
    type: 'user',
  }
}

/** Combine the live transcript with queued inbox drafts without duplicating IDs. */
export function mergeSessionMessages(
  snapshotMessages: SessionMessageInfo[],
  historyMessages: SessionMessageInfo[],
  pendingDrafts: SessionInboxUser[]
): SessionMessageInfo[] {
  const base = snapshotMessages.length > 0 ? snapshotMessages : historyMessages
  if (pendingDrafts.length === 0) return base

  const byID = new Map(base.map((message) => [message.id, message]))
  for (const draft of pendingDrafts) {
    if (!byID.has(draft.id)) byID.set(draft.id, inboxDraftToMessage(draft))
  }
  return [...byID.values()].sort((a, b) => a.time.created - b.time.created)
}
