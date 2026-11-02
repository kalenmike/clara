import type { SessionMessageInfo } from '@opencode/client'

/**
 * A user message can be synthetic input from an automation source. OpenCode
 * keeps it in the user branch, but Clara must not attribute it to the person.
 */
export function isSyntheticMessage(message: SessionMessageInfo): boolean {
  return message.type === 'user' && message.metadata?.synthetic === true
}
