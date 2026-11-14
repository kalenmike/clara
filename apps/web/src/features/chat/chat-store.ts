import type {
  ClaraSessionInboxUser,
  ClaraSessionMessageAssistant,
  ClaraSessionMessageAssistantReasoning,
  ClaraSessionMessageAssistantText,
  ClaraSessionMessageAssistantTool,
  ClaraSessionMessage,
  ClaraSessionMessageUser,
  ClaraSessionStatus,
  ClaraTokenUsage,
  ClaraJsonValue,
  ClaraToolContent,
  ClaraEvent,
} from '@clara/api-contract'
import { inboxDraftToMessage } from './session-messages.ts'

export type ChatSnapshot = {
  messages: ClaraSessionMessage[]
  /** User messages delivered to the harness but not yet in the transcript. */
  sent: ClaraSessionMessageUser[]
  status: ClaraSessionStatus
  cost: number
  tokens?: ClaraTokenUsage
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
  sent: [],
  status: { type: 'idle' },
  cost: 0,
  revision: 0,
  historyRevision: 0,
  hasOlder: false,
}

function isAssistant(message: ClaraSessionMessage): message is ClaraSessionMessageAssistant {
  return message.type === 'assistant'
}

function contentAt(
  message: ClaraSessionMessageAssistant,
  ordinal: number,
  create: () => ClaraSessionMessageAssistant['content'][number]
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

function findTool(message: ClaraSessionMessageAssistant, id: string) {
  return message.content.find(
    (part): part is ClaraSessionMessageAssistantTool => part.type === 'tool' && part.id === id
  )
}

function cloneSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.type === 'assistant' ? { ...message, content: [...message.content] } : message
    ),
    sent: [...snapshot.sent],
  }
}

/** Merge a page into the transcript without duplicating messages or reordering time. */
function mergeMessages(
  existing: ClaraSessionMessage[],
  incoming: ClaraSessionMessage[]
): ClaraSessionMessage[] {
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
  /** Sessions whose status came from a live event or an active-session seed. */
  private statusSynced = new Set<string>()

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

  hydrate(sessionID: string, messages: ClaraSessionMessage[], cursor: string | null) {
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
    const hydrated = replace ? messages : mergeMessages(previous.messages, messages)
    const ids = new Set(hydrated.map((message) => message.id))
    this.snapshots.set(sessionID, {
      messages: hydrated,
      // Keep a delivered prompt until the transcript owns its ID.
      sent: (previous?.sent ?? []).filter((message) => !ids.has(message.id)),
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
    messages: ClaraSessionMessage[],
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
    this.statusSynced.delete(sessionID)
    if (hadSnapshot) this.scheduleNotify(sessionID)
  }

  /** Drop every cached session, used when the client points at a different server. */
  reset() {
    const sessions = [...this.snapshots.keys()]
    this.snapshots.clear()
    this.histories.clear()
    this.pending.clear()
    this.statusSynced.clear()
    for (const sessionID of sessions) this.scheduleNotify(sessionID)
  }

  setUsage(sessionID: string, cost: number, tokens?: ClaraTokenUsage) {
    this.update(sessionID, (snapshot) => ({ ...snapshot, cost, tokens }))
  }

  /**
   * Keep a delivered prompt visible while the harness writes it to the
   * transcript. The transcript entry carries the same message ID, so hydration
   * replaces it instead of adding a duplicate.
   */
  deliverUser(sessionID: string, item: ClaraSessionInboxUser) {
    const message = inboxDraftToMessage(item)
    this.update(sessionID, (snapshot) => {
      if (snapshot.messages.some((existing) => existing.id === message.id)) return snapshot
      if (snapshot.sent.some((existing) => existing.id === message.id)) return snapshot
      return { ...snapshot, sent: [...snapshot.sent, message] }
    })
  }

  /**
   * Seed the run state from the server's active-session map when a thread
   * opens. The event stream is live-only, so an already-running session has no
   * status event to replay and would otherwise sit at the store's idle default.
   * A live event always wins over a seed.
   */
  seedStatus(sessionID: string, status: ClaraSessionStatus) {
    if (this.statusSynced.has(sessionID)) return
    this.statusSynced.add(sessionID)
    this.update(sessionID, (snapshot) => ({ ...snapshot, status }))
  }

  /** Let the next active-session fetch reseed status after a reconnect. */
  resetStatuses() {
    this.statusSynced.clear()
  }

  dispatch(event: ClaraEvent) {
    const data = 'data' in event ? (event.data as { sessionID?: string }) : undefined
    const sessionID = data?.sessionID
    if (!sessionID) return

    switch (event.type) {
      case 'session.inbox.delivered':
        if (event.data.item?.type === 'user') this.deliverUser(sessionID, event.data.item)
        return

      case 'session.step.started':
        this.statusSynced.add(sessionID)
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
          return { ...snapshot, messages, status: { type: 'busy' } }
        })
        return

      case 'session.text.started':
      case 'session.text.delta':
      case 'session.text.ended':
        this.patchMessage(sessionID, event.data.assistantMessageID, (message) => {
          const part = contentAt(message, event.data.ordinal, () => ({
            type: 'text',
            text: '',
          })) as ClaraSessionMessageAssistantText
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
          })) as ClaraSessionMessageAssistantReasoning
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
            name: typeof event.data.input.tool === 'string' ? event.data.input.tool : 'tool',
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
            content: event.data.content as [ClaraToolContent, ...ClaraToolContent[]],
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
            content: event.data.content as [ClaraToolContent, ...ClaraToolContent[]] | undefined,
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
        this.statusSynced.add(sessionID)
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: event.data.status }))
        return

      case 'session.execution.started':
        this.statusSynced.add(sessionID)
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: { type: 'busy' } }))
        return

      case 'session.execution.failed':
        this.statusSynced.add(sessionID)
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
        this.statusSynced.add(sessionID)
        this.update(sessionID, (snapshot) => ({ ...snapshot, status: { type: 'idle' } }))
        return

      default:
        return
    }
  }

  private patchMessage(
    sessionID: string,
    messageID: string,
    patch: (message: ClaraSessionMessageAssistant) => void
  ) {
    this.update(sessionID, (snapshot) => {
      const index = snapshot.messages.findIndex((message) => message.id === messageID)
      if (index === -1) {
        const message: ClaraSessionMessageAssistant = {
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
      const next: ClaraSessionMessageAssistant = { ...current, content: [...current.content] }
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

function parseToolInput(text: string): Record<string, ClaraJsonValue> {
  try {
    return JSON.parse(text) as Record<string, ClaraJsonValue>
  } catch {
    return { raw: text }
  }
}
