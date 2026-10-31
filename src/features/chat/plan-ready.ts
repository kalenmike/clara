import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'

/**
 * A finished Plan reply that carries no error and stopped on its own terms.
 */
export function isFinishedPlanReply(message: SessionMessageAssistant): boolean {
  return message.agent === 'plan' && message.finish === 'stop' && !message.error
}

/**
 * Find a finished Plan reply that is waiting for the person to switch to Build.
 * Persisted history usually ends with an `idle` note, so only the newest user or
 * assistant message decides whether the plan is actually waiting.
 */
export function findPlanReadyReply(
  messages: SessionMessageInfo[],
  sessionAgent: string | undefined,
  busy: boolean
): SessionMessageAssistant | undefined {
  if (busy || sessionAgent !== 'plan') return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'user' && message.type !== 'assistant') continue
    if (message.type !== 'assistant') return undefined
    return isFinishedPlanReply(message) ? message : undefined
  }

  return undefined
}
