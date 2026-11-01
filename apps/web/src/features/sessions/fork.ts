import type { SessionMessageInfo } from '@opencode/client'

export type MessageFork = { before?: string }

/** Only conversational messages are meaningful fork points. */
export function isForkableMessage(message: SessionMessageInfo): boolean {
  return message.type === 'user' || message.type === 'assistant'
}

/**
 * The server's fork boundary is exclusive, so the next message ID is used to
 * copy the selected message and everything before it. The newest message has
 * no next sibling, which makes a full-history fork the inclusive fallback.
 */
export function planMessageFork(
  messages: SessionMessageInfo[],
  messageID: string
): MessageFork | null {
  const index = messages.findIndex((message) => message.id === messageID)
  if (index === -1) return null

  const message = messages[index]
  if (!isForkableMessage(message)) return null

  const next = messages[index + 1]
  return next ? { before: next.id } : {}
}
