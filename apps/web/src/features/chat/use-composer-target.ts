import { useMemo } from 'react'
import type { ClaraSessionInboxUser } from '@clara/api-contract'
import { composerMenuMode, type ComposerMenuMode } from '@/features/chat/composer-menu'
import { findPlanReadyReply } from '@/features/chat/plan-ready'
import { mergeSessionMessages } from '@/features/chat/session-messages'
import { useChatSnapshot, useSessionInbox, useSessionMessages } from '@/features/chat/use-chat'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { useSession } from '@/features/sessions/use-sessions'

/**
 * Session data for the composer window. It is deliberately independent of the
 * route so an open composer keeps reading the session it was opened for.
 */
export function useComposerTarget(sessionID: string) {
  const sessionQuery = useSession(sessionID || null)
  const snapshot = useChatSnapshot(sessionID)
  const messagesQuery = useSessionMessages(sessionID)
  const inboxQuery = useSessionInbox(sessionID)
  const session = sessionQuery.data

  const pendingDrafts = useMemo(
    () => (inboxQuery.data ?? []).filter((item): item is ClaraSessionInboxUser => item.type === 'user'),
    [inboxQuery.data]
  )

  const messages = useMemo(
    () =>
      mergeSessionMessages(snapshot.messages, messagesQuery.data?.messages ?? [], pendingDrafts),
    [messagesQuery.data?.messages, pendingDrafts, snapshot.messages]
  )

  const busy = snapshot.status.type !== 'idle'
  const ready = snapshot.messages.length > 0 || messagesQuery.isSuccess
  const empty = useMemo(
    () => !messages.some((message) => message.type === 'user' || message.type === 'assistant'),
    [messages]
  )
  const hasAssistant = useMemo(
    () => messages.some((message) => message.type === 'assistant'),
    [messages]
  )
  const menuMode: ComposerMenuMode = composerMenuMode({ ready, busy, hasAssistant })
  const planReady = useMemo(
    () =>
      session && !isArchivedSession(session)
        ? findPlanReadyReply(messages, session.agent, busy) !== undefined
        : false,
    [busy, messages, session]
  )

  return {
    session,
    sessionQuery,
    snapshot,
    directory: session?.location.directory,
    busy,
    ready,
    empty,
    menuMode,
    planReady,
    disabled: sessionQuery.isError,
  }
}
