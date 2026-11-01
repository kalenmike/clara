import { assistantHasFailed } from '@clara/shared-types'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'
import { isQuestionTool } from '@/features/chat/questions'
import { isClaraSynthetic } from '@/features/chat/system-events'

export { assistantHasFailed }

/**
 * Internal messages are useful while debugging or auditing a run, but they are
 * not part of the conversation. They are hidden unless the reader opts in.
 */
export function getVisibleMessages(
  messages: SessionMessageInfo[],
  showInternal: boolean,
  streaming: boolean
): SessionMessageInfo[] {
  return messages.filter((message, index) => {
    switch (message.type) {
      case 'system':
      case 'agent-switched':
      case 'idle':
        return false
      case 'user':
      case 'model-switched':
      case 'location-switched':
        return true
      case 'synthetic':
        return isClaraSynthetic(message) || showInternal
      case 'skill':
      case 'compaction':
      case 'shell':
        return showInternal
      case 'assistant':
        if (showInternal) return true
        return (
          assistantHasContent(message, false) ||
          assistantHasFailed(message) ||
          message.content.some(isQuestionTool) ||
          (streaming && index === messages.length - 1)
        )
      default:
        return false
    }
  })
}

/**
 * A turn counts as a reply once it has text to show or a failure to report.
 * Reasoning and tool-only steps still describe work in progress, so they do not
 * take the newest-message slot away from the prompt that started the run.
 */
export function assistantHasReply(message: SessionMessageAssistant): boolean {
  return (
    assistantHasFailed(message) ||
    message.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  )
}

/** Whether an assistant message has anything that is shown at this detail level. */
export function assistantHasContent(
  message: SessionMessageAssistant,
  showInternal: boolean
): boolean {
  return message.content.some((part) => {
    if (part.type === 'text') return part.text.trim().length > 0
    if (!showInternal) return false
    return part.type === 'tool' || part.text.trim().length > 0
  })
}
