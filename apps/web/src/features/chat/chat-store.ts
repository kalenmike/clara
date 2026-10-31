import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStatus,
  TokenUsageInfo,
  JsonValue,
  ToolContent,
  V2Event,
} from '@opencode/client'

export type ChatSnapshot = {
  messages: SessionMessageInfo[]
  status: SessionStatus
  cost: number
  tokens?: TokenUsageInfo
  revision: number
  /** Bumped only when an older page is merged, so the list can anchor itself. */
  historyRevision: number
  /** Whether an older page can still be fetched for this session. */
  hasOlder: boolean
}

type HistoryState = {
  cursor: string | null
  pages: number
  replaceOnHydrate: boolean
  /** Incremented when cached pages must be discarded, so stale requests are ignored. */
  generation: number
}

const EMPTY: ChatSnapshot = {
  messages: [],
  status: { type: 'idle' },
  cost: 0,
  revision: 0,
  historyRevision: 0,
  hasOlder: false,
}

function isAssistant(message: SessionMessageInfo): message is SessionMessageAssistant {
  return message.type === 'assistant'
}

function contentAt(
  message: SessionMessageAssistant,
  ordinal: number,
  create: () => SessionMessageAssistant['content'][number]
) {
  while (message.content.length < ordinal) {
    message.content.push({ type: 'text', text: '' })
  }
  const existing = message.content[ordinal]
  if (existing) return existing
  const part = create()
  message.content[ordinal] = part
  return part
}

function findTool(message: SessionMessageAssistant, id: string) {
  return message.content.find(
    (part): part is SessionMessageAssistantTool => part.type === 'tool' && part.id === id
  )
}

function cloneSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.type === 'assistant' ? { ...message, content: [...message.content] } : message
    ),
  }
}

/** Merge a page into the transcript without duplicating messages or reordering time. */
function mergeMessages(
  existing: SessionMessageInfo[],
  incoming: SessionMessageInfo[]
): SessionMessageInfo[] {
  if (existing.length === 0) return incoming
  if (incoming.length === 0) return existing

  const byID = new Map(existing.map((message) => [message.id, message]))
  for (const message of incoming) byID.set(message.id, message)
  return [...byID.values()].sort((a, b) => a.time.created - b.time.created)
}

class ChatStore {
  private snapshots = new Map<string, ChatSnapshot>()
  private histories = new Map<string, HistoryState>()
  private listeners = new Map<string, Set<() => void>>()
  private pending = new Set<string>()

  getSnapshot = (sessionID: string): ChatSnapshot => this.snapshots.get(sessionID) ?? EMPTY

  subscribe = (sessionID: string, listener: () => void) => {
    let listeners = this.listeners.get(sessionID)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(sessionID, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(sessionID)
    }
  }

  hydrate(sessionID: string, messages: SessionMessageInfo[], cursor: string | null) {
    const previous = this.snapshots.get(sessionID)
    const history = this.histories.get(sessionID)
    const replace = !previous || !history || history.replaceOnHydrate
    const pages = replace ? 0 : (history?.pages ?? 0)
    const nextCursor = pages === 0 ? cursor : (history?.cursor ?? null)

    this.histories.set(sessionID, {
      cursor: nextCursor,
      pages,
      replaceOnHydrate: false,
      generation: history?.generation ?? 0,
    })
    this.snapshots.set(sessionID, {
      messages: replace ? messages : mergeMessages(previous.messages, messages),
      status: previous?.status ?? { type: 'idle' },
      cost: previous?.cost ?? 0,
      tokens: previous?.tokens,
      revision: (previous?.revision ?? 0) + 1,
      historyRevision: previous?.historyRevision ?? 0,
      hasOlder: nextCursor !== null,
    })
    this.scheduleNotify(sessionID)
  }

  /** Add a page that is older than everything already in the snapshot. */
  prependOlder(
    sessionID: string,
    messages: SessionMessageInfo[],
    cursor: string | null,
    generation: number
  ) {
    const history = this.histories.get(sessionID)
    if (!history || history.generation !== generation) return

    const previous = this.snapshots.get(sessionID) ?? EMPTY
    this.histories.set(sessionID, {
      cursor,
      pages: history.pages + 1,
      replaceOnHydrate: false,
      generation: history.generation,
    })
    this.snapshots.set(sessionID, {
      ...previous,
      messages: mergeMessages(previous.messages, messages),
      hasOlder: cursor !== null,
      revision: previous.revision + 1,
      historyRevision: previous.historyRevision + 1,
    })
    this.scheduleNotify(sessionID)
  }

  /** The cursor and generation that identify the next older page. */
  getOlderPage(sessionID: string) {
    const history = this.histories.get(sessionID)
    return { cursor: history?.cursor ?? null, generation: history?.generation ?? 0 }
  }

  /**
   * Forget paginated history without dropping the visible transcript yet. The
   * next head refetch replaces it, which matters after compaction or a revert.
   */
  resetHistory(sessionID: string) {
    const previous = this.snapshots.get(sessionID)
    this.histories.set(sessionID, {
      cursor: null,
      pages: 0,
      replaceOnHydrate: true,
      generation: (this.histories.get(sessionID)?.generation ?? 0) + 1,
    })
    if (!previous) return

    this.snapshots.set(sessionID, {
      ...previous,
      hasOlder: false,
      revision: previous.revision + 1,
    })
    this.scheduleNotify(sessionID)
  }

  /** History may have changed while the stream was down, so drop every page. */
  resetHistories() {
    for (const sessionID of this.snapshots.keys()) this.resetHistory(sessionID)
  }

  forget(sessionID: string) {
    const hadSnapshot = this.snapshots.delete(sessionID)
    this.histories.delete(sessionID)
    if (hadSnapshot) this.scheduleNotify(sessionID)
  }

  /** Drop every cached session, used when the client points at a different server. */
  reset() {
    const sessions = [...this.snapshots.keys()]
    this.snapshots.clear()
    this.histories.clear()
    this.pending.clear()
    for (const sessionID of sessions) this.scheduleNotify(sessionID)
  }

  setUsage(sessionID: string, cost: number, tokens?: TokenUsageInfo) {
    this.update(sessionID, (snapshot) => ({ ...snapshot, cost, tokens }))
  }

  dispatch(event: V2Event) {
    const data = 'data' in event ? (event.data as { sessionID?: string }) : undefined
    const sessionID = data?.sessionID
    if (!sessionID) return

    switch (event.type) {
      case 'session.step.started':
        this.update(sessionID, (snapshot) => {
          const messages = [...snapshot.messages]
          const index = messages.findIndex(
            (message) => message.id === event.data.assistantMessageID
          )
          if (index === -1) {
            messages.push({
              id: event.data.assistantMessageID,
              type: 'assistant',
              time: { created: event.data.started },
              agent: event.data.agent,
              model: event.data.model,
              content: [],
            })
          }
          return { ...snapshot, messages }
        })
        return

      case 'session.text.started':
      case 'session.text.delta':
      case 'session.text.ended':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const part = contentAt(message, event.data.ordinal, () => ({
            type: 'text',
            text: '',
          })) as SessionMessageAssistantText
          if (event.type === 'session.text.ended') part.text = event.data.text
          else if (event.type === 'session.text.delta') part.text += event.data.delta
        })
        return

      case 'session.reasoning.started':
      case 'session.reasoning.delta':
      case 'session.reasoning.ended':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const part = contentAt(message, event.data.ordinal, () => ({
            type: 'reasoning',
            text: '',
          })) as SessionMessageAssistantReasoning
          if (event.type === 'session.reasoning.ended') part.text = event.data.text
          else if (event.type === 'session.reasoning.delta') part.text += event.data.delta
          if (event.type === 'session.reasoning.started') part.time = { created: event.created }
        })
        return

      case 'session.tool.input.started':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          if (findTool(message, event.data.id)) return
          message.content.push({
            type: 'tool',
            id: event.data.id,
            name: event.data.name,
            state: { status: 'streaming', input: '' },
            time: { created: event.created },
          })
        })
        return

      case 'session.tool.input.delta':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (tool?.state.status === 'streaming') tool.state.input += event.data.delta
        })
        return

      case 'session.tool.input.ended':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (!tool) return
          tool.state = { status: 'running', input: parseToolInput(event.data.text), metadata: {} }
        })
        return

      case 'session.tool.called':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (tool) {
            tool.state = { status: 'running', input: event.data.input, metadata: {} }
            tool.executed = event.data.executed
            return
          }
          message.content.push({
            type: 'tool',
            id: event.data.id,
            name: event.data.input.tool ?? 'tool',
            executed: event.data.executed,
            state: { status: 'running', input: event.data.input, metadata: {} },
            time: { created: event.created },
          })
        })
        return

      case 'session.tool.progress':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (!tool || tool.state.status !== 'running') return
          tool.state = {
            ...tool.state,
            metadata: { ...tool.state.metadata, ...event.data.metadata },
          }
        })
        return

      case 'session.tool.success':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (!tool) return
          tool.state = {
            status: 'completed',
            input: tool.state.status === 'running' ? tool.state.input : {},
            content: event.data.content as [ToolContent, ...ToolContent[]],
            metadata: event.data.metadata ?? {},
          }
          tool.executed = event.data.executed
          tool.time = { ...tool.time, completed: event.created }
        })
        return

      case 'session.tool.failed':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const tool = findTool(message, event.data.id)
          if (!tool) return
          tool.state = {
            status: 'error',
            input: tool.state.status === 'running' ? tool.state.input : {},
            error: event.data.error,
            content: event.data.content as [ToolContent, ...ToolContent[]] | undefined,
          }
          tool.executed = event.data.executed
          tool.time = { ...tool.time, completed: event.created }
        })
        return

      case 'session.step.failed':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          message.finish = 'error'
          message.error = event.data.error
          message.time = { ...message.time, completed: event.created }
          if (event.data.cost !== undefined) message.cost = event.data.cost
          if (event.data.tokens) message.tokens = event.data.tokens
        })
        return

      case 'session.step.ended':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          message.cost = event.data.cost
          message.tokens = event.data.tokens
          message.finish = event.data.finish
          message.time = { ...message.time, completed: event.created }
        })
        return

      case 'session.usage.updated':
        this.update(sessionID, (snapshot) => ({
          ...snapshot,
          cost: event.data.cost,
          tokens: event.data.tokens,
        }))
        return

      case 'session.status':
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: event.data.status }))
        return

      case 'session.execution.started':
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: { type: 'busy' } }))
        return

      case 'session.execution.failed':
        this.update(sessionID, (snapshot) => {
          const messages = [...snapshot.messages]
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index]
            if (message.type !== 'assistant') continue
            if (!message.error && !message.time.completed) {
              messages[index] = {
                ...message,
                finish: 'error',
                error: event.data.error,
                time: { ...message.time, completed: event.created },
              }
            }
            break
          }
          return { ...snapshot, messages, status: { type: 'idle' } }
        })
        return

      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
      case 'session.idle':
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: { type: 'idle' } }))
        return

      default:
        return
    }
  }

  private patchMessage(
    sessionID: string,
    messageID: string,
    patch: (message: SessionMessageAssistant) => void
  ) {
    this.update(sessionID, (snapshot) => {
      const index = snapshot.messages.findIndex((message) => message.id === messageID)
      if (index === -1) {
        const message: SessionMessageAssistant = {
          id: messageID,
          type: 'assistant',
          time: { created: Date.now() },
          agent: '',
          model: { id: '', providerID: '' },
          content: [],
        }
        patch(message)
        return { ...snapshot, messages: [...snapshot.messages, message] }
      }

      const current = snapshot.messages[index]
      if (!isAssistant(current)) return snapshot
      const next: SessionMessageAssistant = { ...current, content: [...current.content] }
      patch(next)
      const messages = [...snapshot.messages]
      messages[index] = next
      return { ...snapshot, messages }
    })
  }

  private update(sessionID: string, update: (snapshot: ChatSnapshot) => ChatSnapshot) {
    const previous = this.snapshots.get(sessionID) ?? EMPTY
    const next = update(cloneSnapshot(previous))
    this.snapshots.set(sessionID, {
      ...next,
      revision: previous.revision + 1,
    })
    this.scheduleNotify(sessionID)
  }

  private scheduleNotify(sessionID: string) {
    if (this.pending.has(sessionID)) return
    this.pending.add(sessionID)
    requestAnimationFrame(() => {
      this.pending.delete(sessionID)
      this.listeners.get(sessionID)?.forEach((listener) => listener())
    })
  }
}

export const chatStore = new ChatStore()

function parseToolInput(text: string): Record<string, JsonValue> {
  try {
    return JSON.parse(text) as Record<string, JsonValue>
  } catch {
    return { raw: text }
  }
}
