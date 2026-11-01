import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'
import { isQuestionTool, questionEvent } from '@/features/chat/questions'
import { assistantHasContent, assistantHasFailed } from '@/features/chat/message-visibility'
import type { SystemEvent } from '@/features/chat/system-events'
import { readClaraEvent } from '@/features/chat/system-events'

export type TimelineItem =
  | { type: 'message'; key: string; message: SessionMessageInfo }
  | { type: 'event'; key: string; event: SystemEvent }

/**
 * Turn visible session messages into transcript rows. Clara's synthetic inputs
 * become system events, question-tool results become answer events, and the
 * raw question tool card is removed so the answer is not shown twice.
 */
export function buildTimeline(
  messages: SessionMessageInfo[],
  options: { showInternal: boolean; streaming: boolean }
): TimelineItem[] {
  const items: TimelineItem[] = []

  messages.forEach((message, index) => {
    if (message.type === 'synthetic') {
      const event = readClaraEvent(message)
      if (event) {
        items.push({ type: 'event', key: `event:${event.id}`, event })
        return
      }
      if (options.showInternal) {
        items.push({ type: 'message', key: `message:${message.id}`, message })
      }
      return
    }

    if (message.type !== 'assistant') {
      items.push({ type: 'message', key: `message:${message.id}`, message })
      return
    }

    const questionTools = message.content.filter(isQuestionTool)
    if (questionTools.length === 0) {
      items.push({ type: 'message', key: `message:${message.id}`, message })
      return
    }

    const withoutQuestions: SessionMessageAssistant = {
      ...message,
      content: message.content.filter((part) => !isQuestionTool(part)),
    }
    const isLast = index === messages.length - 1
    const keepAssistant =
      assistantHasContent(withoutQuestions, options.showInternal) ||
      assistantHasFailed(withoutQuestions) ||
      (options.streaming && isLast)

    if (keepAssistant) {
      items.push({ type: 'message', key: `message:${message.id}`, message: withoutQuestions })
    }

    for (const tool of questionTools) {
      const event = questionEvent(tool)
      if (event) items.push({ type: 'event', key: `event:${event.id}`, event })
    }
  })

  return items
}
