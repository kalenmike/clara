import type {
  ClaraJsonValue,
  ClaraSessionMessageAssistantTool,
  ClaraSessionMessage,
  ClaraSessionMessageShell,
  ClaraToolContent,
} from '@clara/api-contract'

const MAX_ENTRIES = 300
const MAX_OUTPUT_LINES = 400
const MAX_PROMPT_LENGTH = 180

const SHELL_TOOLS = new Set(['bash', 'shell', 'terminal'])

export type TerminalStatus = 'preparing' | 'running' | 'completed' | 'error' | 'timeout' | 'killed'

export type TerminalEntry =
  | {
      kind: 'prompt'
      id: string
      text: string
      at: number
    }
  | {
      kind: 'command'
      id: string
      command: string
      description?: string
      output?: string
      error?: string
      status: TerminalStatus
      exit?: number
      started: number
      completed?: number
    }
  | {
      kind: 'tool'
      id: string
      name: string
      summary?: string
      status: TerminalStatus
      at: number
      completed?: number
    }

export type TerminalLog = {
  entries: TerminalEntry[]
  truncated: boolean
}

export function buildTerminalLog(messages: ClaraSessionMessage[]): TerminalLog {
  const entries: TerminalEntry[] = []

  for (const message of messages) {
    if (message.type === 'user') {
      const text = firstLine(message.text, MAX_PROMPT_LENGTH)
      if (text) entries.push({ kind: 'prompt', id: message.id, text, at: message.time.created })
      continue
    }

    if (message.type === 'shell') {
      entries.push(shellEntry(message))
      continue
    }

    if (message.type !== 'assistant') continue

    for (const part of message.content) {
      if (part.type !== 'tool') continue
      entries.push(toolEntry(message.id, part))
    }
  }

  const truncated = entries.length > MAX_ENTRIES
  return {
    entries: truncated ? entries.slice(-MAX_ENTRIES) : entries,
    truncated,
  }
}

function shellEntry(message: ClaraSessionMessageShell): TerminalEntry {
  return {
    kind: 'command',
    id: `shell:${message.id}`,
    command: message.command,
    output: message.output?.output ? sanitizeOutput(message.output.output) : undefined,
    status: shellStatus(message),
    exit: typeof message.exit === 'number' ? message.exit : undefined,
    started: message.time.created,
    completed: message.time.completed,
  }
}

function toolEntry(messageID: string, tool: ClaraSessionMessageAssistantTool): TerminalEntry {
  const id = `tool:${messageID}:${tool.id}`
  const status = toolStatus(tool)

  if (isCommandTool(tool)) {
    const command = commandOf(tool)
    if (!command) {
      return {
        kind: 'tool',
        id,
        name: tool.name,
        summary: status === 'preparing' ? 'preparing…' : undefined,
        status,
        at: tool.time.created,
      }
    }

    const result = resultOf(tool)
    return {
      kind: 'command',
      id,
      command,
      description: inputString(tool, 'description'),
      output: result.output,
      error: result.error,
      status,
      exit: result.exit,
      started: tool.time.created,
      completed: tool.time.completed,
    }
  }

  const summary = toolSummary(tool)
  if (!summary && status === 'preparing') {
    return {
      kind: 'tool',
      id,
      name: tool.name,
      summary: 'preparing…',
      status,
      at: tool.time.created,
    }
  }

  return {
    kind: 'tool',
    id,
    name: tool.name,
    summary,
    status,
    at: tool.time.created,
    completed: tool.time.completed,
  }
}

function isCommandTool(tool: ClaraSessionMessageAssistantTool): boolean {
  if (SHELL_TOOLS.has(tool.name)) return true
  return tool.state.status !== 'streaming' && typeof tool.state.input.command === 'string'
}

function commandOf(tool: ClaraSessionMessageAssistantTool): string | undefined {
  if (tool.state.status === 'streaming') return undefined
  const command = tool.state.input.command
  return typeof command === 'string' && command.trim().length > 0 ? command : undefined
}

function inputString(tool: ClaraSessionMessageAssistantTool, key: string): string | undefined {
  if (tool.state.status === 'streaming') return undefined
  const value = tool.state.input[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function toolSummary(tool: ClaraSessionMessageAssistantTool): string | undefined {
  if (tool.state.status === 'streaming') return undefined
  const input = tool.state.input
  for (const key of ['command', 'path', 'filePath', 'pattern', 'query', 'url', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  const first = Object.values(input).find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  )
  return first
}

function resultOf(tool: ClaraSessionMessageAssistantTool): {
  output?: string
  error?: string
  exit?: number
} {
  if (tool.state.status === 'streaming') return {}

  const metadata = tool.state.metadata
  const streamed = jsonString(metadata, 'output')
  const content =
    tool.state.status === 'completed' || tool.state.status === 'error'
      ? contentText(tool.state.content)
      : undefined

  return {
    output: sanitizeOutput(streamed ?? content),
    error: tool.state.status === 'error' ? tool.state.error.message : undefined,
    exit: jsonNumber(metadata, 'exit'),
  }
}

function contentText(content: ClaraToolContent[] | undefined) {
  if (!content) return undefined
  const text = content
    .filter((item): item is Extract<ClaraToolContent, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  return text.trim().length > 0 ? text : undefined
}

function jsonString(metadata: { [key: string]: ClaraJsonValue } | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function jsonNumber(metadata: { [key: string]: ClaraJsonValue } | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toolStatus(tool: ClaraSessionMessageAssistantTool): TerminalStatus {
  switch (tool.state.status) {
    case 'streaming':
      return 'preparing'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'error':
      return 'error'
  }
}

function shellStatus(message: ClaraSessionMessageShell): TerminalStatus {
  if (message.status === 'running') return 'running'
  if (message.status === 'timeout') return 'timeout'
  if (message.status === 'killed') return 'killed'
  if (typeof message.exit === 'number' && message.exit !== 0) return 'error'
  return 'completed'
}

function firstLine(text: string, max: number): string {
  const line = text.split('\n').find((value) => value.trim().length > 0)
  if (!line) return ''
  const trimmed = line.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/* eslint-disable no-control-regex */
const ANSI_OSC = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const ANSI_OTHER = /\x1b[@-_]/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
/* eslint-enable no-control-regex */

function sanitizeOutput(text: string | undefined): string | undefined {
  if (!text) return undefined

  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_OTHER, '')
    .replace(CONTROL, '')

  const lines = cleaned.split('\n').map((line) => {
    const segments = line.split('\r')
    return segments[segments.length - 1] ?? ''
  })

  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop()
  if (lines.length === 0) return undefined

  if (lines.length > MAX_OUTPUT_LINES) {
    return `… output truncated to the last ${MAX_OUTPUT_LINES} lines …\n${lines
      .slice(-MAX_OUTPUT_LINES)
      .join('\n')}`
  }

  return lines.join('\n')
}
