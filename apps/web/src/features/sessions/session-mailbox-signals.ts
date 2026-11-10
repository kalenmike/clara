import type { OpenCodeClient } from '@/lib/client'
import { assistantHasFailed } from '@/features/chat/message-visibility'
import { isFinishedPlanReply } from '@/features/chat/plan-ready'
import type { SessionMailboxSignals } from '@/features/sessions/session-mailbox'
import { withMailboxSignalSlot } from '@/features/sessions/session-mailbox-queue'

/**
 * Load the signals that decide a session's mailbox. The newest user and
 * assistant messages are fetched separately because the server's newest message
 * is often an internal `idle` note.
 */
export async function loadSessionMailboxSignals(
  client: OpenCodeClient,
  sessionID: string,
  signal?: AbortSignal
): Promise<SessionMailboxSignals> {
  return withMailboxSignalSlot(async () => {
    const [users, assistants, forms] = await Promise.all([
      client.message.list({ sessionID, order: 'desc', limit: 1, type: 'user' }, { signal }),
      client.message.list({ sessionID, order: 'desc', limit: 1, type: 'assistant' }, { signal }),
      client.session.form.list({ sessionID }, { signal }).catch(() => []),
    ])

    const lastUser = users.data[0]
    const lastAssistant = assistants.data[0]
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
  })
}
