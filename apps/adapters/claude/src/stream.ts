import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeContentBlock, ClaudeTurnEvent, ClaudeUsage } from './sdk.ts'

type StreamBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; toolID: string; name: string; input: string }

/**
 * Translates one SDK turn's partial-message frames into Clara events.
 *
 * Stream frames and completed assistant messages carry unrelated wrapper
 * UUIDs, and the SDK emits one assistant message per completed content block.
 * The Anthropic API message ID is the only stable identity for one model
 * response, so every event for that response uses it.
 */
export class ClaudeStreamTranslator {
  private assistantMessageID?: string
  private readonly blocks = new Map<number, StreamBlock>()

  streamEvent(message: SDKPartialAssistantMessage): ClaudeTurnEvent[] {
    const event = message.event

    if (event.type === 'message_start') {
      const assistantMessageID = event.message.id || message.uuid
      this.assistantMessageID = assistantMessageID
      this.blocks.clear()
      return [
        {
          type: 'message-start',
          assistantMessageID,
          model: event.message.model,
          ...(message.user_message_uuid ? { userMessageID: message.user_message_uuid } : {}),
        },
      ]
    }

    if (event.type === 'message_stop') {
      const events = this.closeBlocks()
      this.assistantMessageID = undefined
      this.blocks.clear()
      return events
    }

    const assistantMessageID = this.assistantMessageID ?? message.uuid
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block.type === 'text') {
        this.blocks.set(event.index, { kind: 'text', text: block.text })
        return [{ type: 'text-started', assistantMessageID, ordinal: event.index }]
      }
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        this.blocks.set(event.index, { kind: 'thinking', text: '' })
        return [{ type: 'reasoning-started', assistantMessageID, ordinal: event.index }]
      }
      if (block.type === 'tool_use') {
        this.blocks.set(event.index, {
          kind: 'tool',
          toolID: block.id,
          name: block.name,
          input: '',
        })
        return [
          {
            type: 'tool-input-started',
            assistantMessageID,
            index: event.index,
            toolID: block.id,
            name: block.name,
          },
        ]
      }
      return []
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta
      const block = this.blocks.get(event.index)
      if (delta.type === 'text_delta') {
        if (block?.kind === 'text') block.text += delta.text
        return [
          {
            type: 'text-delta',
            assistantMessageID,
            ordinal: event.index,
            delta: delta.text,
          },
        ]
      }
      if (delta.type === 'thinking_delta') {
        if (block?.kind === 'thinking') block.text += delta.thinking
        return [
          {
            type: 'reasoning-delta',
            assistantMessageID,
            ordinal: event.index,
            delta: delta.thinking,
          },
        ]
      }
      if (delta.type === 'input_json_delta' && block?.kind === 'tool') {
        block.input += delta.partial_json
        return [
          {
            type: 'tool-input-delta',
            assistantMessageID,
            index: event.index,
            toolID: block.toolID,
            delta: delta.partial_json,
          },
        ]
      }
      return []
    }

    if (event.type === 'content_block_stop') {
      return this.closeBlock(event.index, assistantMessageID)
    }

    return []
  }

  assistant(message: SDKAssistantMessage, aborted: boolean): ClaudeTurnEvent[] {
    const assistantMessageID = message.message.id || message.uuid
    const events: ClaudeTurnEvent[] = []
    const content: ClaudeContentBlock[] = []

    for (const block of message.message.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text })
      } else if (block.type === 'thinking') {
        content.push({ type: 'thinking', text: block.thinking })
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: recordOf(block.input),
        })
        events.push({
          type: 'tool-called',
          assistantMessageID,
          toolID: block.id,
          input: recordOf(block.input),
        })
      }
    }

    events.push({
      type: 'assistant',
      assistantMessageID,
      model: message.message.model,
      content,
      ...(message.message.stop_reason ? { stopReason: message.message.stop_reason } : {}),
      usage: usageOf(message.message.usage),
      aborted: message.aborted === true || aborted,
      ...(message.user_message_uuid ? { userMessageID: message.user_message_uuid } : {}),
    })
    return events
  }

  /** Close blocks left open by an interrupted or truncated stream. */
  private closeBlocks(): ClaudeTurnEvent[] {
    const assistantMessageID = this.assistantMessageID
    if (!assistantMessageID) return []
    const events: ClaudeTurnEvent[] = []
    for (const index of [...this.blocks.keys()].sort((a, b) => a - b)) {
      events.push(...this.closeBlock(index, assistantMessageID))
    }
    return events
  }

  private closeBlock(index: number, assistantMessageID: string): ClaudeTurnEvent[] {
    const block = this.blocks.get(index)
    if (!block) return []
    this.blocks.delete(index)

    if (block.kind === 'text') {
      return [
        {
          type: 'text-ended',
          assistantMessageID,
          ordinal: index,
          text: block.text,
        },
      ]
    }
    if (block.kind === 'thinking') {
      return [
        {
          type: 'reasoning-ended',
          assistantMessageID,
          ordinal: index,
          text: block.text,
        },
      ]
    }
    return [
      {
        type: 'tool-input-ended',
        assistantMessageID,
        index,
        toolID: block.toolID,
        text: block.input,
      },
    ]
  }
}

export function usageOf(value: unknown): ClaudeUsage {
  const usage = recordOf(value)
  return {
    input: numberValue(usage?.input_tokens),
    output: numberValue(usage?.output_tokens),
    reasoning: numberValue(usage?.thinking_tokens),
    cacheRead: numberValue(usage?.cache_read_input_tokens),
    cacheWrite: numberValue(usage?.cache_creation_input_tokens),
  }
}

export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
