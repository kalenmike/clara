/**
 * Pick the composer's secondary send action. A new session can save its first
 * message as a no-reply draft; an active run can queue a follow-up behind it.
 * An idle session past its first reply has no alternative, so it keeps plain
 * Send.
 */
export type ComposerMenuMode = 'draft' | 'queue' | null

export function composerMenuMode(input: {
  ready: boolean
  busy: boolean
  hasAssistant: boolean
}): ComposerMenuMode {
  if (!input.ready) return null
  if (input.busy) return 'queue'
  if (!input.hasAssistant) return 'draft'
  return null
}
