import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'
import { isQuestionTool, questionEvent } from '@/features/chat/questions'
import {
  assistantHasContent,
  assistantHasFailed,
  getVisibleMessages,
} from '@/features/chat/message-visibility'
import type { SystemEvent } from '@/features/chat/system-events'
import { readClaraEvent } from '@/features/chat/system-events'
import { hasUsage, summarizeSteps, type UsageSummary } from '@/features/chat/usage-summary'

export type TimelineItem =
  | { type: 'message'; key: string; message: SessionMessageInfo; usageSummary?: UsageSummary }
  | { type: 'event'; key: string; event: SystemEvent }
  | { type: 'hidden-activity'; key: string; summary: UsageSummary; streaming: boolean }

/**
 * Turn visible session messages into transcript rows. Clara's synthetic inputs
 * become system events, question-tool results become answer events, and the
 * raw question tool card is removed so the answer is not shown twice.
 *
 * Hidden assistant steps do not disappear entirely. Their usage rolls into the
 * next visible assistant reply so a tool-heavy turn still accounts for what it
 * spent. A trailing batch with no reply keeps a thinking row.
 */
export function buildTimeline(
  messages: SessionMessageInfo[],
  options: { showInternal: boolean; streaming: boolean }
): TimelineItem[] {
  const visible = getVisibleMessages(messages, options.showInternal)
  const visibleIDs = new Set(visible.map((message) => message.id))
  const lastAssistantID = [...messages]
    .reverse()
    .find((message) => message.type === 'assistant')?.id
  const items: TimelineItem[] = []
  let hidden: SessionMessageAssistant[] = []

  const takeHidden = () => {
    const steps = hidden
    hidden = []
    return steps
  }

  const pushSummary = (summary: UsageSummary | undefined, key: string, streaming: boolean) => {
    if (!summary || options.showInternal) return
    if (!hasUsage(summary) && !streaming) return
    items.push({ type: 'hidden-activity', key: `hidden:${key}`, summary, streaming })
  }

  const flushHidden = (streaming = false) => {
    const steps = takeHidden()
    if (steps.length === 0) return
    pushSummary(summarizeSteps(steps), steps[0]!.id, streaming)
  }

  const summaryFor = (message: SessionMessageAssistant): UsageSummary | undefined => {
    if (options.showInternal) return undefined
    const hasInternals = message.content.some(
      (part) => part.type === 'tool' || (part.type === 'reasoning' && part.text.trim().length > 0)
    )
    const steps = takeHidden()
    if (steps.length === 0 && !hasInternals) return undefined
    return summarizeSteps([...steps, message])
  }

  messages.forEach((message) => {
    if (message.type === 'assistant' && !visibleIDs.has(message.id)) {
      hidden.push(message)
      return
    }

    if (!visibleIDs.has(message.id)) return

    if (message.type !== 'assistant') {
      flushHidden()
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
      items.push({ type: 'message', key: `message:${message.id}`, message })
      return
    }

    const questionTools = message.content.filter(isQuestionTool)
    if (questionTools.length === 0) {
      const usageSummary = summaryFor(message)
      items.push({ type: 'message', key: `message:${message.id}`, message, usageSummary })
      return
    }

    const withoutQuestions: SessionMessageAssistant = {
      ...message,
      content: message.content.filter((part) => !isQuestionTool(part)),
    }
    const keepAssistant =
      assistantHasContent(withoutQuestions, options.showInternal) ||
      assistantHasFailed(withoutQuestions) ||
      (options.streaming && message.id === lastAssistantID)

    const usageSummary = summaryFor(withoutQuestions)
    if (keepAssistant) {
      items.push({
        type: 'message',
        key: `message:${message.id}`,
        message: withoutQuestions,
        usageSummary,
      })
    } else if (usageSummary) {
      pushSummary(usageSummary, message.id, false)
    }

    for (const tool of questionTools) {
      const event = questionEvent(tool)
      if (event) items.push({ type: 'event', key: `event:${event.id}`, event })
    }
  })

  flushHidden(options.streaming)
  return items
}
