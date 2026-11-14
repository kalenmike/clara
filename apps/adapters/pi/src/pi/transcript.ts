import type {
  ClaraJsonValue,
  ClaraSessionMessage,
  ClaraToolContent,
  ClaraTokenUsage,
} from '@clara/api-contract'
import {
  activeBranch,
  entryTime,
  messageText,
  sessionModel,
  type PiContent,
  type PiEntry,
  type PiMessage,
  type PiUsage,
  type ParsedSession,
} from './format.ts'

export type PromptIdentity = {
  id: string
  kind: 'user' | 'synthetic'
  description?: string
}

export type TranscriptInput = {
  session: ParsedSession
  providerID: string
  agent: string
  prompts?: Map<number, PromptIdentity>
}

/**
 * Map Pi's persisted tree onto Clara's linear transcript. Clara renders the
 * active branch; abandoned branches remain in the file and in Pi's tree view.
 */
export function mapTranscript(input: TranscriptInput): ClaraSessionMessage[] {
  const branch = activeBranch(input.session.entries)
  const toolResults = new Map<string, PiEntry>()
  for (const entry of branch) {
    const id = entry.message?.role === 'toolResult' ? entry.message.toolCallId : undefined
    if (id && entry.message) toolResults.set(id, entry)
  }

  const messages: ClaraSessionMessage[] = []
  for (const entry of branch) {
    const message = entry.message
    if (entry.type === 'message' && message) {
      const mapped = mapMessage(message, entry, input, toolResults)
      if (mapped) messages.push(mapped)
      continue
    }
    if (entry.type === 'compaction') {
      messages.push({
        id: entry.id ?? `compaction-${messages.length}`,
        type: 'compaction',
        status: 'completed',
        reason: 'auto',
        summary: typeof entry.summary === 'string' ? entry.summary : 'Context compacted',
        time: { created: entryTime(entry) },
        ...(entry.usage
          ? { tokens: tokensOf(entry.usage), cost: entry.usage.cost?.total ?? 0 }
          : {}),
      })
      continue
    }
    if (entry.type === 'branch_summary' && typeof entry.summary === 'string') {
      messages.push({
        id: entry.id ?? `branch-${messages.length}`,
        type: 'system',
        text: entry.summary,
        description: 'Branch summary',
        time: { created: entryTime(entry) },
      })
      continue
    }
    if (entry.type === 'model_change' && entry.provider && entry.modelId) {
      messages.push({
        id: entry.id ?? `model-${messages.length}`,
        type: 'model-switched',
        model: { id: entry.modelId, providerID: entry.provider },
        time: { created: entryTime(entry) },
      })
      continue
    }
    if (entry.type === 'custom_message' && entry.display !== false) {
      const text = typeof entry.content === 'string' ? entry.content : ''
      if (text) {
        messages.push({
          id: entry.id ?? `custom-${messages.length}`,
          type: 'system',
          text,
          ...(typeof entry.customType === 'string' ? { description: entry.customType } : {}),
          time: { created: entryTime(entry) },
        })
      }
    }
  }
  return messages
}

function mapMessage(
  message: PiMessage,
  entry: PiEntry,
  input: TranscriptInput,
  toolResults: Map<string, PiEntry>
): ClaraSessionMessage | undefined {
  const time = message.timestamp ?? entryTime(entry)
  if (message.role === 'user') {
    const text = messageText(message.content).trim() || imagePlaceholder(message.content)
    if (!text) return undefined
    const identity =
      message.timestamp !== undefined ? input.prompts?.get(message.timestamp) : undefined
    if (identity?.kind === 'synthetic') {
      return {
        id: identity.id,
        type: 'synthetic',
        text,
        ...(identity.description ? { description: identity.description } : {}),
        time: { created: time },
      }
    }
    return {
      id: identity?.id ?? `pi-u-${message.timestamp ?? entry.id ?? time}`,
      type: 'user',
      text,
      time: { created: time },
    }
  }
  if (message.role === 'assistant') {
    const content: Extract<ClaraSessionMessage, { type: 'assistant' }>['content'] = []
    for (const block of blocksOf(message.content)) {
      if (block.type === 'text') {
        if (block.text) content.push({ type: 'text', text: block.text })
        continue
      }
      if (block.type === 'thinking') {
        if (block.thinking) content.push({ type: 'reasoning', text: block.thinking })
        continue
      }
      if (block.type === 'toolCall') {
        const result = toolResults.get(block.id)
        const resultMessage = result?.message
        if (resultMessage) {
          const toolContent = toolContentOf(resultMessage.content)
          content.push({
            type: 'tool',
            id: block.id,
            name: block.name,
            executed: true,
            state: resultMessage.isError
              ? {
                  status: 'error',
                  input: block.arguments as Record<string, ClaraJsonValue>,
                  error: {
                    type: 'tool_error',
                    message: messageText(resultMessage.content) || 'The tool failed',
                  },
                  content: toolContent,
                }
              : {
                  status: 'completed',
                  input: block.arguments as Record<string, ClaraJsonValue>,
                  content: toolContent,
                },
            time: { created: time, ...(result ? { completed: entryTime(result) } : {}) },
          })
        } else {
          content.push({
            type: 'tool',
            id: block.id,
            name: block.name,
            executed: true,
            state: {
              status: 'running',
              input: block.arguments as Record<string, ClaraJsonValue>,
              metadata: {},
            },
            time: { created: time },
          })
        }
      }
    }
    const model =
      message.model && message.provider
        ? { id: message.model, providerID: message.provider }
        : (sessionModel(input.session.entries) ?? {
            id: message.model ?? 'unknown',
            providerID: input.providerID,
          })
    return {
      id: `pi-a-${message.timestamp ?? entry.id ?? time}`,
      type: 'assistant',
      agent: input.agent,
      model,
      content,
      time: {
        created: time,
        ...(entry.timestamp ? { completed: entryTime(entry) } : {}),
      },
      finish: finishOf(message.stopReason),
      ...(message.stopReason ? { rawFinish: message.stopReason } : {}),
      ...(message.usage
        ? { cost: message.usage.cost?.total ?? 0, tokens: tokensOf(message.usage) }
        : {}),
      ...(message.errorMessage
        ? { error: { type: 'pi_error', message: message.errorMessage } }
        : {}),
    }
  }
  if (message.role === 'bashExecution') {
    return {
      id: entry.id ?? `shell-${time}`,
      type: 'shell',
      shellID: entry.id ?? `shell-${time}`,
      command: message.command ?? '',
      status: message.cancelled ? 'killed' : 'exited',
      ...(typeof message.exitCode === 'number' ? { exit: message.exitCode } : {}),
      output: {
        output: message.output ?? '',
        cursor: message.output?.length ?? 0,
        size: message.output?.length ?? 0,
        truncated: message.truncated === true,
      },
      time: { created: time, completed: time },
    }
  }
  if (message.role === 'custom' && message.display !== false) {
    const text = messageText(message.content).trim()
    if (!text) return undefined
    return {
      id: entry.id ?? `custom-${time}`,
      type: 'system',
      text,
      ...(message.customType ? { description: message.customType } : {}),
      time: { created: time },
    }
  }
  if (message.role === 'branchSummary' && message.summary) {
    return {
      id: entry.id ?? `branch-${time}`,
      type: 'system',
      text: message.summary,
      description: 'Branch summary',
      time: { created: time },
    }
  }
  if (message.role === 'compactionSummary' && message.summary) {
    return {
      id: entry.id ?? `compaction-${time}`,
      type: 'compaction',
      status: 'completed',
      reason: 'auto',
      summary: message.summary,
      time: { created: time },
    }
  }
  return undefined
}

export function tokensOf(usage: PiUsage): ClaraTokenUsage {
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    reasoning: usage.reasoning ?? 0,
    cache: {
      read: usage.cacheRead ?? 0,
      write: usage.cacheWrite ?? 0,
    },
  }
}

export function finishOf(
  reason: string | undefined
): 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown' {
  switch (reason) {
    case 'stop':
    case 'endTurn':
      return 'stop'
    case 'length':
      return 'length'
    case 'toolUse':
      return 'tool-calls'
    case 'aborted':
    case 'error':
      return 'error'
    default:
      return 'unknown'
  }
}

function blocksOf(content: PiMessage['content']): PiContent[] {
  if (!content) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

function imagePlaceholder(content: PiMessage['content']): string {
  return Array.isArray(content) && content.some((block) => block.type === 'image') ? '[image]' : ''
}

export function toolContentOf(
  content: PiMessage['content']
): [ClaraToolContent, ...ClaraToolContent[]] {
  const blocks: ClaraToolContent[] = []
  for (const block of blocksOf(content)) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      blocks.push({
        type: 'file',
        uri: `data:${block.mimeType};base64,${block.data}`,
        mime: block.mimeType,
        name: 'image',
      })
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'text', text: '' })
  return blocks as [ClaraToolContent, ...ClaraToolContent[]]
}
