#!/usr/bin/env node
// A minimal Pi RPC stand-in used by the adapter tests. It implements only the
// records the adapter sends and asserts nothing about the real Pi internals.
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  process.stdout.write('1.5.2\n')
  process.exit(0)
}
if (argv.includes('--help')) {
  process.stdout.write(
    'Usage: pi [options]\n  --mode <text|json|rpc>\n  --session <path|id>\n  --session-id <id>\n'
  )
  process.exit(0)
}

const value = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

const sessionFileArg = value('--session')
const sessionIdArg = value('--session-id')
const noSession = argv.includes('--no-session')
const providedName = value('--name')

let sessionFile = sessionFileArg
let sessionId = sessionIdArg ?? randomUUID()
let sessionName = providedName
let lastId = null

function loadSession() {
  if (!sessionFile || !existsSync(sessionFile)) {
    if (!sessionFile) return
    mkdirSync(dirname(sessionFile), { recursive: true })
    const header = {
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }
    writeFileSync(sessionFile, `${JSON.stringify(header)}\n`)
    return
  }
  const lines = readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'session') {
        sessionId = entry.id
        lastId = null
      } else {
        lastId = entry.id ?? lastId
        if (entry.type === 'session_info' && typeof entry.name === 'string')
          sessionName = entry.name
      }
    } catch {
      // Ignore partial lines.
    }
  }
}

loadSession()

function append(entry) {
  if (!sessionFile || noSession) return
  const record = {
    ...entry,
    id: entry.id ?? randomUUID().replaceAll('-', '').slice(0, 8),
    parentId: entry.parentId ?? lastId,
  }
  lastId = record.id
  appendFileSync(sessionFile, `${JSON.stringify(record)}\n`)
}

function send(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

function respond(id, command, data) {
  send({ id, type: 'response', command, success: true, ...(data === undefined ? {} : { data }) })
}

const model = {
  id: 'fake-model',
  name: 'Fake Model',
  provider: 'fake',
  api: 'fake',
  input: ['text'],
  contextWindow: 128000,
  maxTokens: 8192,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
}

let isStreaming = false
let lastAssistant = null

function runPrompt(id, message) {
  const userTimestamp = Date.now()
  const assistantTimestamp = userTimestamp + 1
  const text = typeof message === 'string' ? message : ''
  append({
    type: 'message',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: userTimestamp },
  })
  send({
    type: 'message_start',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: userTimestamp },
  })
  isStreaming = true
  send({ type: 'agent_start' })
  send({ type: 'turn_start' })
  const assistant = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'thinking...' },
      { type: 'text', text: `echo: ${text}` },
    ],
    api: 'fake',
    provider: 'fake',
    model: 'fake-model',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 1,
      cacheWrite: 0,
      reasoning: 2,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    },
    stopReason: process.env.FAKE_PI_ERROR === '1' ? 'error' : 'stop',
    ...(process.env.FAKE_PI_ERROR === '1' ? { errorMessage: 'fake failure' } : {}),
    timestamp: assistantTimestamp,
  }
  send({ type: 'message_start', message: assistant })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 },
  })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'thinking...' },
  })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'thinking...' },
  })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'text_start', contentIndex: 1 },
  })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: `echo: ${text}` },
  })
  send({
    type: 'message_update',
    usage: assistant.usage,
    assistantMessageEvent: { type: 'text_end', contentIndex: 1, content: `echo: ${text}` },
  })
  send({ type: 'message_end', message: assistant })
  append({
    type: 'message',
    timestamp: new Date().toISOString(),
    message: assistant,
  })
  lastAssistant = assistant
  send({ type: 'turn_end', message: assistant, toolResults: [] })
  isStreaming = false
  respond(id, 'prompt', { disposition: 'started' })
  send({ type: 'agent_end', messages: [assistant], willRetry: false })
  send({ type: 'agent_settled', aborted: process.env.FAKE_PI_ABORT === '1' })
}

const pendingUi = new Map()

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  const id = command.id
  switch (command.type) {
    case 'get_state':
      respond(id, 'get_state', {
        model,
        thinkingLevel: 'medium',
        isStreaming,
        sessionFile,
        sessionId,
        ...(sessionName ? { sessionName } : {}),
        messageCount: 1,
      })
      return
    case 'get_commands':
      respond(id, 'get_commands', {
        commands: [
          { name: 'review', source: 'prompt', description: 'Review the change' },
          {
            name: 'skill:fake',
            source: 'skill',
            description: 'Fake skill',
            sourceInfo: { path: `${process.cwd()}/.pi/skills/fake/SKILL.md` },
          },
        ],
      })
      return
    case 'get_available_models':
      respond(id, 'get_available_models', { models: [model] })
      return
    case 'get_session_stats':
      respond(id, 'get_session_stats', {
        cost: 0.01,
        tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, total: 15 },
      })
      return
    case 'prompt':
      if (process.env.FAKE_PI_UI === 'confirm') {
        pendingUi.set('ui-1', { id, command })
        send({
          type: 'extension_ui_request',
          id: 'ui-1',
          method: 'confirm',
          title: 'Allow this command?',
          message: 'The fake extension wants approval.',
        })
        return
      }
      runPrompt(id, command.message)
      return
    case 'steer':
    case 'follow_up':
      respond(id, command.type, { disposition: 'queued' })
      return
    case 'abort':
      respond(id, 'abort')
      send({ type: 'agent_settled', aborted: true })
      return
    case 'clear_queue':
      respond(id, 'clear_queue', { steering: [], followUp: [] })
      return
    case 'set_model':
      model.id = command.modelId
      model.provider = command.provider
      respond(id, 'set_model', model)
      return
    case 'set_thinking_level':
      respond(id, 'set_thinking_level')
      return
    case 'set_session_name':
      sessionName = command.name
      append({
        type: 'session_info',
        timestamp: new Date().toISOString(),
        name: command.name,
      })
      respond(id, 'set_session_name')
      return
    case 'compact':
      send({ type: 'compaction_start', reason: 'manual' })
      append({
        type: 'compaction',
        timestamp: new Date().toISOString(),
        summary: 'Compacted',
        firstKeptEntryId: lastId ?? '',
        tokensBefore: 100,
        usage: { input: 3, output: 1, cost: { total: 0.001 } },
      })
      respond(id, 'compact', {
        summary: 'Compacted',
        usage: { input: 3, output: 1, cost: { total: 0.001 } },
      })
      send({
        type: 'compaction_end',
        reason: 'manual',
        result: { summary: 'Compacted' },
        aborted: false,
        willRetry: false,
      })
      return
    case 'extension_ui_response': {
      const pending = pendingUi.get(command.id)
      pendingUi.delete(command.id)
      if (pending) runPrompt(pending.id, pending.command.message)
      return
    }
    default:
      respond(id, command.type)
      return
  }
})

rl.on('close', () => {
  process.exit(0)
})

// Keep the process alive while stdin is open.
setInterval(() => {}, 1_000).unref()
