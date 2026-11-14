import { readFileSync } from 'node:fs'
import type { ClaraTokenUsage } from '@clara/api-contract'

export type PiTextContent = { type: 'text'; text: string }
export type PiImageContent = { type: 'image'; data: string; mimeType: string }
export type PiThinkingContent = { type: 'thinking'; thinking: string; redacted?: boolean }
export type PiToolCallContent = {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}
export type PiContent = PiTextContent | PiImageContent | PiThinkingContent | PiToolCallContent

export type PiUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  totalTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

export type PiMessage = {
  role: string
  content?: string | PiContent[]
  timestamp?: number
  provider?: string
  model?: string
  usage?: PiUsage
  stopReason?: string
  errorMessage?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
  command?: string
  output?: string
  exitCode?: number
  cancelled?: boolean
  truncated?: boolean
  customType?: string
  display?: boolean
  details?: unknown
  summary?: string
}

export type PiEntry = {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  message?: PiMessage
  name?: string
  provider?: string
  modelId?: string
  thinkingLevel?: string
  summary?: string
  usage?: PiUsage
  customType?: string
  data?: unknown
  [key: string]: unknown
}

export type PiSessionHeader = {
  type: 'session'
  version?: number
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
}

export type ParsedSession = {
  header: PiSessionHeader
  entries: PiEntry[]
}

export type PiSessionSummary = {
  path: string
  id: string
  cwd: string
  name?: string
  parentSession?: string
  created: number
  updated: number
  messageCount: number
  firstMessage: string
  model?: { id: string; providerID: string }
  cost: number
  tokens: ClaraTokenUsage
  lastEntryId?: string
  version: number
}

/** Read a session file, tolerating a partial trailing line from a live writer. */
export function readSession(path: string): ParsedSession {
  return parseSession(readFileSync(path, 'utf8'))
}

export function parseSession(text: string): ParsedSession {
  const lines = text.split('\n')
  const parsed: unknown[] = []
  for (const line of lines) {
    const value = line.trim()
    if (!value) continue
    try {
      parsed.push(JSON.parse(value))
    } catch {
      // A live writer can leave a partial last line. Ignore unparseable lines.
    }
  }
  const header = parsed.find(isHeader)
  if (!header) throw new Error('The file is not a Pi session')
  const entries: PiEntry[] = []
  let previous: string | null = null
  for (const value of parsed) {
    if (value === header) continue
    if (!isRecord(value) || typeof value.type !== 'string') continue
    const entry = value as PiEntry
    if (typeof entry.id !== 'string') entry.id = `legacy-${entries.length}`
    if (entry.parentId === undefined) entry.parentId = previous
    previous = entry.id
    entries.push(entry)
  }
  return { header, entries }
}

export function sessionSummary(path: string, session: ParsedSession): PiSessionSummary {
  const { header, entries } = session
  const usage = sessionUsage(entries)
  const created = Date.parse(header.timestamp)
  const updated = entries.length > 0 ? entryTime(entries[entries.length - 1]!) : created
  const model = sessionModel(entries)
  const last = entries[entries.length - 1]
  return {
    path,
    id: header.id,
    cwd: header.cwd,
    ...(sessionName(entries) ? { name: sessionName(entries) } : {}),
    ...(header.parentSession ? { parentSession: header.parentSession } : {}),
    created: Number.isFinite(created) ? created : Date.now(),
    updated: Number.isFinite(updated) ? updated : Date.now(),
    messageCount: entries.filter((entry) => entry.type === 'message').length,
    firstMessage: firstUserText(entries),
    ...(model ? { model } : {}),
    cost: usage.cost,
    tokens: usage.tokens,
    ...(last?.id ? { lastEntryId: last.id } : {}),
    version: header.version ?? 1,
  }
}

export function sessionName(entries: PiEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type === 'session_info') {
      return typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined
    }
  }
  return undefined
}

export function firstUserText(entries: PiEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message?.role !== 'user') continue
    const text = messageText(entry.message.content).trim()
    if (text) return text.slice(0, 240)
  }
  return ''
}

export function messageText(content: PiMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

export function sessionModel(entries: PiEntry[]): { id: string; providerID: string } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type === 'model_change' && entry.provider && entry.modelId) {
      return { id: entry.modelId, providerID: entry.provider }
    }
    if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.model) {
      return {
        id: entry.message.model,
        providerID: entry.message.provider ?? 'pi',
      }
    }
  }
  return undefined
}

/** Pi reports full-session totals, including compaction and abandoned branches. */
export function sessionUsage(entries: PiEntry[]): { cost: number; tokens: ClaraTokenUsage } {
  const tokens: ClaraTokenUsage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
  let cost = 0
  const add = (usage: PiUsage | undefined) => {
    if (!usage) return
    tokens.input += numberOrZero(usage.input)
    tokens.output += numberOrZero(usage.output)
    tokens.reasoning += numberOrZero(usage.reasoning)
    tokens.cache.read += numberOrZero(usage.cacheRead)
    tokens.cache.write += numberOrZero(usage.cacheWrite)
    cost += numberOrZero(usage.cost?.total)
  }
  for (const entry of entries) {
    if (entry.type === 'message') add(entry.message?.usage)
    else if (entry.type === 'usage') add(entry.usage)
    else if (entry.type === 'compaction' || entry.type === 'branch_summary') add(entry.usage)
  }
  return { cost, tokens }
}

/** The active branch, from root to the last appended entry. */
export function activeBranch(entries: PiEntry[]): PiEntry[] {
  if (entries.length === 0) return []
  const byId = new Map<string, PiEntry>()
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry)
  }
  const path: PiEntry[] = []
  let current: PiEntry | undefined = entries[entries.length - 1]
  const seen = new Set<string>()
  while (current) {
    if (current.id) {
      if (seen.has(current.id)) break
      seen.add(current.id)
    }
    path.push(current)
    const parentId: string | null | undefined = current.parentId
    current = typeof parentId === 'string' ? byId.get(parentId) : undefined
  }
  if (path.length === 0) return entries
  return path.reverse()
}

export function entryTime(entry: PiEntry): number {
  if (entry.timestamp) {
    const value = Date.parse(entry.timestamp)
    if (Number.isFinite(value)) return value
  }
  const messageTime = entry.message?.timestamp
  return typeof messageTime === 'number' ? messageTime : 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isHeader(value: unknown): value is PiSessionHeader {
  return (
    isRecord(value) &&
    value.type === 'session' &&
    typeof value.id === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.timestamp === 'string'
  )
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
