import type {
  PermissionRequest,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageInfo,
} from '@opencode/client'

export type PermissionThinkingRequest = Pick<PermissionRequest, 'source'>

/**
 * The reasoning that led to a pending permission request. The server's source
 * points at the assistant step and tool call that asked, so only the reasoning
 * before that tool is returned. Requests without a source, or whose message is
 * no longer loaded, fall back to the newest assistant step.
 */
export function findPermissionThinking(
  messages: SessionMessageInfo[],
  request: PermissionThinkingRequest
): string {
  const source = request.source
  if (source?.type === 'tool') {
    const message = messages.find(
      (item): item is SessionMessageAssistant =>
        item.type === 'assistant' && item.id === source.messageID
    )
    if (message) return reasoningBeforeTool(message, source.id)
  }

  const newest = newestAssistant(messages)
  return newest ? joinReasoning(newest.content) : ''
}

function reasoningBeforeTool(message: SessionMessageAssistant, toolID: string): string {
  const toolIndex = message.content.findIndex((part) => part.type === 'tool' && part.id === toolID)
  const parts = toolIndex === -1 ? message.content : message.content.slice(0, toolIndex)
  return joinReasoning(parts)
}

function joinReasoning(content: SessionMessageAssistant['content']): string {
  return content
    .filter((part): part is SessionMessageAssistantReasoning => part.type === 'reasoning')
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

function newestAssistant(messages: SessionMessageInfo[]): SessionMessageAssistant | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === 'assistant') return message
  }
  return undefined
}
