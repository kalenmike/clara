import type { ClaraSessionMessage } from '@clara/api-contract'

/**
 * A user message can be synthetic input from an automation source. OpenCode
 * keeps it in the user branch, but Clara must not attribute it to the person.
 */
export function isSyntheticMessage(message: ClaraSessionMessage): boolean {
  return message.type === 'user' && message.metadata?.synthetic === true
}
