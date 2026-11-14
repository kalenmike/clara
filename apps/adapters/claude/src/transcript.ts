import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ClaraJsonValue,
  ClaraSessionMessage,
  ClaraSessionMessageAssistant,
  ClaraSessionMessageAssistantTool,
  ClaraTokenUsage,
} from '@clara/api-contract'
import { emptyTokens } from './store.ts'

export type TranscriptEntry = Record<string, unknown> & {
  type?: string
  subtype?: string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  message?: unknown
  isSidechain?: boolean
  isMeta?: boolean
}

export type TranscriptUsage = {
  cost: number
  tokens: ClaraTokenUsage
  model?: string
}

type RawMessage = {
  id?: string
  model?: string
  role?: string
  content?: unknown
  stop_reason?: string | null
  usage?: Record<string, unknown>
}

type RawBlock = {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { type?: string; media_type?: string; data?: string }
}

const SYSTEM_REMINDER = /<system-reminder>([\s\S]*?)<\/system-reminder>/gi

export function claudeProjectsDirectory(
  authProjectsDirectory?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (authProjectsDirectory) return authProjectsDirectory
  const configDirectory = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(configDirectory, 'projects')
}

export function encodeProjectDirectory(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Find the JSONL transcript, falling back to a scan when the encoded name differs. */
export function findTranscript(
  projectsDirectory: string,
  directory: string,
  sessionId: string
): string | undefined {
  const direct = join(projectsDirectory, encodeProjectDirectory(directory), `${sessionId}.jsonl`)
  if (existsSync(direct)) return direct
  try {
    for (const entry of readdirSync(projectsDirectory)) {
      const candidate = join(projectsDirectory, entry, `${sessionId}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    // The Claude config directory may not exist yet.
  }
  return undefined
}

export function readTranscript(path: string): TranscriptEntry[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const entries: TranscriptEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries.push(parsed as TranscriptEntry)
      }
    } catch {
      // A partial trailing line is normal while a turn is being written.
    }
  }
  return entries
}

export function transcriptUsage(entries: TranscriptEntry[]): TranscriptUsage {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.type !== 'result') continue
    const cost = numberOf(entry.total_cost_usd)
    const usage = recordOf(entry.usage)
    if (cost !== undefined || usage) {
      return {
        cost: cost ?? 0,
        tokens: usageTokens(usage),
      }
    }
  }

  const tokens = emptyTokens()
  let model: string | undefined
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue
    const message = entry.message as RawMessage | undefined
    if (!message) continue
    const usage = message.usage
    if (usage) {
      const next = usageTokens(usage)
      tokens.input += next.input
      tokens.output += next.output
      tokens.reasoning += next.reasoning
      tokens.cache.read += next.cache.read
      tokens.cache.write += next.cache.write
    }
    if (typeof message.model === 'string') model = message.model
  }
  return { cost: 0, tokens, ...(model ? { model } : {}) }
}

/**
 * Map Claude's transcript entries to Clara messages. Tool results are folded
 * into the assistant tool part that requested them, and sidechain/subagent
 * content is skipped because Clara has no nested session model.
 */
export function mapTranscript(
  entries: TranscriptEntry[],
  fallbackStart: number,
  providerID: string
): ClaraSessionMessage[] {
  const messages: ClaraSessionMessage[] = []
  const tools = new Map<
    string,
    { message: ClaraSessionMessageAssistant; part: ClaraSessionMessageAssistantTool }
  >()
  let clock = fallbackStart
  let index = 0
  /**
   * The SDK emits one assistant message per completed content block, all
   * sharing the Anthropic API message ID. Keep those blocks in one Clara step
   * so a reload matches the live stream.
   */
  let lastAssistant:
    | {
        id: string
        message: ClaraSessionMessageAssistant
        pushed: boolean
      }
    | undefined

  for (const entry of entries) {
    index += 1
    const time = timestampOf(entry.timestamp) ?? clock + 1
    clock = Math.max(clock, time)

    if (entry.isSidechain === true) continue

    if (entry.type === 'assistant') {
      const message = entry.message as RawMessage | undefined
      if (!message) continue
      const id = assistantMessageID(message, entry, index)
      const transcriptID = typeof entry.uuid === 'string' ? entry.uuid : undefined

      let assistant: ClaraSessionMessageAssistant
      if (lastAssistant?.id === id) {
        assistant = lastAssistant.message
        assistant.time = { ...assistant.time, completed: time }
        if (transcriptID) {
          assistant.native = { ...(assistant.native ?? {}), transcriptID }
        }
      } else {
        assistant = {
          id,
          type: 'assistant',
          time: { created: time, completed: time },
          agent: 'claude',
          model: {
            id: typeof message.model === 'string' && message.model ? message.model : 'default',
            providerID,
          },
          content: [],
          ...(transcriptID ? { native: { transcriptID } } : {}),
        }
        lastAssistant = {
          id,
          message: assistant,
          pushed: false,
        }
      }

      if (message.stop_reason) assistant.finish = finishOf(message.stop_reason)
      if (message.usage) assistant.tokens = usageTokens(message.usage)
      if (typeof message.model === 'string' && message.model) {
        assistant.model = { id: message.model, providerID }
      }
      appendAssistantBlocks(assistant, message.content, time, tools)

      if (!lastAssistant.pushed && assistant.content.length > 0) {
        messages.push(assistant)
        lastAssistant.pushed = true
      }
      continue
    }

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      const metadata = recordOf(entry.compactMetadata) ?? recordOf(entry.compact_metadata)
      const trigger = metadata?.trigger === 'manual' ? 'manual' : 'auto'
      messages.push({
        id: typeof entry.uuid === 'string' ? entry.uuid : `compaction-${index}`,
        type: 'compaction',
        time: { created: time },
        status: 'completed',
        reason: trigger,
        summary: typeof entry.summary === 'string' ? entry.summary : '',
      })
      continue
    }

    if (entry.type !== 'user') continue
    lastAssistant = undefined
    const message = entry.message as RawMessage | undefined
    const content = message?.content
    const text: string[] = []
    const files: NonNullable<Extract<ClaraSessionMessage, { type: 'user' }>['files']> = []
    let sawToolResult = false

    for (const block of blocksOf(content)) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        sawToolResult = true
        completeTool(tools.get(block.tool_use_id), block, time)
      } else if (block.type === 'text' && typeof block.text === 'string') {
        text.push(block.text)
      } else if (
        block.type === 'image' &&
        block.source?.type === 'base64' &&
        block.source.data &&
        block.source.media_type
      ) {
        files.push({
          data: block.source.data,
          mime: block.source.media_type,
          source: { type: 'inline' },
        })
      }
    }

    const { text: visible, reminders } = splitSystemReminders(text.join('\n'))
    if (sawToolResult && !visible.trim() && files.length === 0) continue
    if (!visible.trim() && files.length === 0) {
      if (reminders.length > 0) {
        messages.push({
          id: typeof entry.uuid === 'string' ? entry.uuid : `synthetic-${index}`,
          type: 'synthetic',
          time: { created: time },
          text: reminders
            .map((reminder) => `<system-reminder>${reminder}</system-reminder>`)
            .join('\n'),
          description: 'System reminder',
        })
      }
      continue
    }

    if (entry.isMeta === true) {
      messages.push({
        id: typeof entry.uuid === 'string' ? entry.uuid : `synthetic-${index}`,
        type: 'synthetic',
        time: { created: time },
        text: visible,
      })
      continue
    }

    messages.push({
      id: typeof entry.uuid === 'string' ? entry.uuid : `user-${index}`,
      type: 'user',
      time: { created: time },
      text: visible,
      ...(files.length > 0 ? { files } : {}),
    })
  }

  return messages
}

function assistantMessageID(message: RawMessage, entry: TranscriptEntry, index: number): string {
  if (typeof message.id === 'string' && message.id) return message.id
  if (typeof entry.uuid === 'string') return entry.uuid
  return `assistant-${index}`
}

function appendAssistantBlocks(
  assistant: ClaraSessionMessageAssistant,
  content: unknown,
  time: number,
  tools: Map<
    string,
    { message: ClaraSessionMessageAssistant; part: ClaraSessionMessageAssistantTool }
  >
): void {
  for (const block of blocksOf(content)) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      assistant.content.push({ type: 'text', text: block.text })
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      assistant.content.push({
        type: 'reasoning',
        text: block.thinking,
        time: { created: time },
      })
    } else if (block.type === 'tool_use' && block.id && block.name) {
      const part: ClaraSessionMessageAssistantTool = {
        type: 'tool',
        id: block.id,
        name: block.name,
        executed: true,
        state: { status: 'running', input: jsonRecordOf(block.input), metadata: {} },
        time: { created: time, ran: time },
      }
      assistant.content.push(part)
      tools.set(block.id, { message: assistant, part })
    }
  }
}

function completeTool(
  owner:
    { message: ClaraSessionMessageAssistant; part: ClaraSessionMessageAssistantTool } | undefined,
  block: RawBlock,
  time: number
): void {
  if (!owner) return
  const text = toolResultText(block.content)
  owner.part.time = { ...owner.part.time, completed: time }
  if (block.is_error === true) {
    owner.part.state = {
      status: 'error',
      input: jsonRecordOf(owner.part.state.status === 'running' ? owner.part.state.input : {}),
      error: { type: 'tool_error', message: text || 'The tool failed' },
      ...(text ? { content: [{ type: 'text' as const, text }] } : {}),
    }
  } else {
    owner.part.state = {
      status: 'completed',
      input: jsonRecordOf(owner.part.state.status === 'running' ? owner.part.state.input : {}),
      content: [{ type: 'text', text }],
      metadata: {},
    }
  }
}

function splitSystemReminders(text: string): { text: string; reminders: string[] } {
  const reminders: string[] = []
  const visible = text.replace(SYSTEM_REMINDER, (_match, inner: string) => {
    const value = inner.trim()
    if (value) reminders.push(value)
    return ''
  })
  return { text: visible.trim(), reminders }
}

function blocksOf(content: unknown): RawBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is RawBlock =>
      Boolean(block) && typeof block === 'object' && !Array.isArray(block)
  )
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

function usageTokens(usage: Record<string, unknown> | undefined): ClaraTokenUsage {
  return {
    input: numberOf(usage?.input_tokens) ?? 0,
    output: numberOf(usage?.output_tokens) ?? 0,
    reasoning: numberOf(usage?.thinking_tokens) ?? 0,
    cache: {
      read: numberOf(usage?.cache_read_input_tokens) ?? 0,
      write: numberOf(usage?.cache_creation_input_tokens) ?? 0,
    },
  }
}

function finishOf(reason: string): 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'unknown' {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
    case 'pause_turn':
      return 'tool-calls'
    case 'max_tokens':
      return 'length'
    case 'refusal':
      return 'content-filter'
    default:
      return 'unknown'
  }
}

function timestampOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function jsonRecordOf(value: unknown): Record<string, ClaraJsonValue> {
  return (recordOf(value) ?? {}) as Record<string, ClaraJsonValue>
}
