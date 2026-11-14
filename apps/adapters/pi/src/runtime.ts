import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  ClaraEvent,
  ClaraForm,
  ClaraFormValue,
  ClaraJsonValue,
  ClaraModelRef,
  ClaraPermissionRequest,
  ClaraSession,
  ClaraSessionInboxCompaction,
  ClaraSessionInboxInfo,
  ClaraSessionInboxSynthetic,
  ClaraSessionInboxUser,
  ClaraTokenUsage,
} from '@clara/api-contract'
import { AdapterError } from '@clara/adapter-runtime'
import type { PiConfig, PiThinkingLevel } from './config.ts'
import { sessionDirFor } from './config.ts'
import type { EventBus } from './events.ts'
import { activeBranch, messageText, sessionUsage, type PiMessage } from './pi/format.ts'
import type { PiRpcRecord, PiUiRequest } from './pi/client.ts'
import { PiProcessManager, type PiSessionHandle } from './pi/manager.ts'
import type { PromptIdentity } from './pi/transcript.ts'
import { finishOf, toolContentOf } from './pi/transcript.ts'
import type { SessionService } from './sessions.ts'

const PROMPT_TIMEOUT_MS = 60_000
const COMMAND_TIMEOUT_MS = 30_000
const UI_TIMEOUT_MS = 10 * 60_000
const THINKING_LEVELS = new Set<PiThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type PromptInput = {
  text: string
  files?: unknown[]
  agents?: unknown[]
  skills?: unknown[]
  delivery?: 'steer' | 'queue'
  resume?: boolean
}

export type SyntheticInput = {
  text: string
  description?: string
  delivery?: 'steer' | 'queue'
}

export type CommandInput = {
  name: string
  text?: string
  files?: unknown[]
  delivery?: 'steer' | 'queue'
}

export type CompactInput = {
  delivery?: 'steer' | 'queue'
  customInstructions?: string
}

type QueuedInbox = {
  item: ClaraSessionInboxInfo
  identity: PromptIdentity
  text: string
  images: PiImage[]
  action: 'prompt' | 'compact'
}

type PiImage = { type: 'image'; data: string; mimeType: string }

type ActiveTurn = {
  sessionID: string
  handle: PiSessionHandle
  directory: string
  busy: boolean
  synthetic: boolean
  interrupted: boolean
  sawStart: boolean
  failed?: string
  assistantMessageID?: string
  assistantModel?: { id: string; providerID: string }
  endedSteps: Set<string>
  ordinals: Map<number, number>
  nextOrdinal: number
  completed: Set<string>
  tools: Set<string>
  toolByIndex: Map<number, string>
  pending: PromptIdentity[]
  queue: QueuedInbox[]
  compactionCommand: boolean
}

type PendingPermission = {
  request: ClaraPermissionRequest
  sessionID: string
  directory: string
  requestID: string
  timer: NodeJS.Timeout
}

type PendingForm = {
  form: ClaraForm
  sessionID: string
  directory: string
  requestID: string
  timer: NodeJS.Timeout
}

/**
 * Owns Pi children, prompt queues, streamed event translation, and the
 * extension UI dialogs Pi surfaces through RPC mode.
 */
export class PiRuntime {
  private readonly config: PiConfig
  private readonly sessions: SessionService
  private readonly bus: EventBus
  private readonly manager: PiProcessManager
  private readonly turns = new Map<string, ActiveTurn>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly pendingForms = new Map<string, PendingForm>()
  private closed = false

  constructor(config: PiConfig, binary: string, sessions: SessionService, bus: EventBus) {
    this.config = config
    this.sessions = sessions
    this.bus = bus
    this.manager = new PiProcessManager({
      config,
      binary,
      onEvent: (handle, event) => this.onEvent(handle, event),
      onUiRequest: (handle, request) => this.onUiRequest(handle, request),
      onExit: (handle) => this.onExit(handle),
    })
    sessions.closeSession = (sessionID) => this.manager.dispose(sessionID)
  }

  async prompt(sessionID: string, input: PromptInput): Promise<ClaraSessionInboxUser> {
    const item: ClaraSessionInboxUser = {
      id: randomUUID(),
      sessionID,
      type: 'user',
      delivery: input.delivery ?? 'steer',
      payload: {
        text: input.text,
        ...(input.files ? { files: filesPayload(input.files) } : {}),
      },
      time: { created: Date.now() },
    }
    const identity: PromptIdentity = { id: item.id, kind: 'user' }
    await this.submit(sessionID, input.text, input.files, identity, item, 'prompt')
    return item
  }

  async synthetic(sessionID: string, input: SyntheticInput): Promise<ClaraSessionInboxSynthetic> {
    const item: ClaraSessionInboxSynthetic = {
      id: randomUUID(),
      sessionID,
      type: 'synthetic',
      delivery: input.delivery ?? 'steer',
      payload: {
        text: input.text,
        ...(input.description ? { description: input.description } : {}),
      },
      time: { created: Date.now() },
    }
    const identity: PromptIdentity = {
      id: item.id,
      kind: 'synthetic',
      ...(input.description ? { description: input.description } : {}),
    }
    await this.submit(
      sessionID,
      input.text,
      undefined,
      identity,
      item,
      'prompt',
      input.delivery ?? 'steer'
    )
    return item
  }

  async command(sessionID: string, input: CommandInput): Promise<void> {
    const text = `/${input.name}${input.text?.trim() ? ` ${input.text}` : ''}`
    const item: ClaraSessionInboxUser = {
      id: randomUUID(),
      sessionID,
      type: 'user',
      delivery: input.delivery ?? 'steer',
      payload: {
        text,
        ...(input.files ? { files: filesPayload(input.files) } : {}),
      },
      time: { created: Date.now() },
    }
    await this.submit(
      sessionID,
      text,
      input.files,
      { id: item.id, kind: 'user' },
      item,
      'prompt',
      input.delivery ?? 'steer',
      false
    )
  }

  async compact(sessionID: string, input: CompactInput): Promise<ClaraSessionInboxCompaction> {
    const item: ClaraSessionInboxCompaction = {
      id: randomUUID(),
      sessionID,
      type: 'compaction',
      delivery: input.delivery ?? 'queue',
      payload: {},
      time: { created: Date.now() },
    }
    const active = this.turns.get(sessionID)
    if (active && active.busy) {
      active.queue.push({
        item,
        identity: { id: item.id, kind: 'user' },
        text: '',
        images: [],
        action: 'compact',
      })
      this.emit('session.inbox.enqueued', { sessionID, inboxID: item.id, item })
      return item
    }
    this.emit('session.inbox.delivered', { sessionID, inboxID: item.id, item })
    await this.compactNow(sessionID, input.customInstructions)
    return item
  }

  async interrupt(sessionID: string): Promise<{ interrupted: boolean }> {
    const active = this.turns.get(sessionID)
    if (!active || !active.busy) return { interrupted: false }
    active.interrupted = true
    this.cancelUiRequests(sessionID, 'The user interrupted the run')
    try {
      await active.handle.client.request({ type: 'abort' }, 30_000)
    } catch {
      // agent_settled or an exit still completes the turn.
    }
    return { interrupted: true }
  }

  async setModel(sessionID: string, model: ClaraModelRef): Promise<void> {
    const target = await this.sessions.target(sessionID)
    const handle = await this.manager.open(target)
    const previous = handle.state.model
      ? { id: handle.state.model.id, providerID: handle.state.model.provider }
      : undefined
    const state = await handle.client.request<{ id: string; name?: string; provider: string }>(
      { type: 'set_model', provider: model.providerID, modelId: model.id },
      COMMAND_TIMEOUT_MS
    )
    if (model.variant && THINKING_LEVELS.has(model.variant as PiThinkingLevel)) {
      await handle.client
        .request(
          { type: 'set_thinking_level', level: model.variant as PiThinkingLevel },
          COMMAND_TIMEOUT_MS
        )
        .catch(() => {})
    }
    handle.state.model = { ...state, name: state.name ?? state.id }
    this.emit('session.model.selected', {
      sessionID,
      model: { id: state.id, providerID: state.provider },
      ...(previous ? { previous } : {}),
    })
    this.sessions.invalidateProjects()
  }

  async setAgent(sessionID: string, agent: string): Promise<void> {
    if (agent !== 'pi') {
      throw new AdapterError(400, 'invalid_request', 'Pi runs a single built-in agent')
    }
    this.emit('session.agent.selected', { sessionID, agent: 'pi' })
  }

  activeSessions(): Record<string, { type: 'running' }> {
    const result: Record<string, { type: 'running' }> = {}
    for (const [sessionID, active] of this.turns) {
      if (active.busy) result[sessionID] = { type: 'running' }
    }
    return result
  }

  inbox(sessionID: string): ClaraSessionInboxInfo[] {
    return this.turns.get(sessionID)?.queue.map((entry) => entry.item) ?? []
  }

  async cancelInbox(sessionID: string, inboxID: string): Promise<void> {
    const active = this.turns.get(sessionID)
    if (!active) return
    const index = active.queue.findIndex((entry) => entry.item.id === inboxID)
    if (index < 0) return
    active.queue.splice(index, 1)
    this.emit('session.inbox.cancelled', { sessionID, inboxID })
    if (active.busy) {
      try {
        await active.handle.client.request({ type: 'clear_queue' }, COMMAND_TIMEOUT_MS)
      } catch {
        return
      }
      for (const entry of active.queue) {
        if (entry.action !== 'prompt') continue
        try {
          await active.handle.client.request(
            {
              type: entry.item.delivery === 'queue' ? 'follow_up' : 'steer',
              message: entry.text,
              ...(entry.images.length > 0 ? { images: entry.images } : {}),
            },
            COMMAND_TIMEOUT_MS
          )
          active.pending.push(entry.identity)
        } catch {
          // A failed re-queue leaves the item in Clara's inbox for a retry.
        }
      }
    }
  }

  permissions(directory?: string): ClaraPermissionRequest[] {
    return [...this.pendingPermissions.values()]
      .filter((pending) => !directory || pending.directory === directory)
      .map((pending) => pending.request)
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: 'once' | 'always' | 'reject',
    message?: string
  ): Promise<void> {
    const pending = this.pendingPermissions.get(requestID)
    if (!pending || pending.sessionID !== sessionID) {
      throw new AdapterError(404, 'PermissionNotFoundError', 'That permission request is gone')
    }
    this.pendingPermissions.delete(requestID)
    clearTimeout(pending.timer)
    this.emit('permission.replied', { sessionID, requestID, reply: decision })
    if (decision === 'reject') {
      this.handleFor(sessionID)?.client.respond({
        id: pending.requestID,
        confirmed: false,
      })
      if (message) console.error(`[pi] extension confirmation rejected: ${message}`)
      return
    }
    this.handleFor(sessionID)?.client.respond({ id: pending.requestID, confirmed: true })
  }

  forms(sessionID: string): ClaraForm[] {
    return [...this.pendingForms.values()]
      .filter((pending) => pending.sessionID === sessionID)
      .map((pending) => pending.form)
  }

  async replyForm(
    sessionID: string,
    formID: string,
    answer: Record<string, ClaraFormValue>
  ): Promise<void> {
    const pending = this.pendingForms.get(formID)
    if (!pending || pending.sessionID !== sessionID) {
      throw new AdapterError(404, 'FormNotFoundError', 'That question is no longer waiting')
    }
    this.pendingForms.delete(formID)
    clearTimeout(pending.timer)
    this.emit('form.replied', { id: formID, sessionID, answer })
    const value = answer.value
    this.handleFor(sessionID)?.client.respond({
      id: pending.requestID,
      value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    })
  }

  async cancelForm(sessionID: string, formID: string): Promise<void> {
    const pending = this.pendingForms.get(formID)
    if (!pending || pending.sessionID !== sessionID) {
      throw new AdapterError(404, 'FormNotFoundError', 'That question is no longer waiting')
    }
    this.pendingForms.delete(formID)
    clearTimeout(pending.timer)
    this.emit('form.cancelled', { id: formID, sessionID })
    this.handleFor(sessionID)?.client.respond({ id: pending.requestID, cancelled: true })
  }

  async fork(sessionID: string, before?: string): Promise<ClaraSession> {
    const parent = await this.sessions.read(sessionID)
    const branch = activeBranch(parent.session.entries)
    const boundary = before
      ? boundaryIndex(branch, before, this.sessions.identities(sessionID))
      : branch.length
    if (boundary <= 0) {
      throw new AdapterError(400, 'invalid_request', 'There is no message to fork before')
    }
    const newID = randomUUID()
    const time = new Date()
    const title = parent.summary.name ? `${parent.summary.name} (fork)` : undefined
    const header = {
      type: 'session' as const,
      version: 3,
      id: newID,
      timestamp: time.toISOString(),
      cwd: parent.summary.cwd,
      parentSession: parent.path,
    }
    const copied = branch.slice(0, boundary)
    const lines = [JSON.stringify(header), ...copied.map((entry) => JSON.stringify(entry))]
    if (title) {
      lines.push(
        JSON.stringify({
          type: 'session_info',
          id: randomUUID().replaceAll('-', '').slice(0, 8),
          parentId: copied[copied.length - 1]?.id ?? null,
          timestamp: time.toISOString(),
          name: title,
        })
      )
    }
    const directory = sessionDirFor(this.config, parent.summary.cwd)
    const path = `${directory}/${time.toISOString().replace(/[:.]/g, '-')}_${newID}.jsonl`
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 })
    this.sessions.invalidateProjects()
    this.emit('session.forked', {
      sessionID: newID,
      parentID: sessionID,
      boundary: { type: 'before', messageID: before ?? '' },
    })
    return this.sessions.fromPath(path)
  }

  async close(): Promise<void> {
    this.closed = true
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timer)
      this.handleFor(pending.sessionID)?.client.respond({
        id: pending.requestID,
        cancelled: true,
      })
    }
    for (const pending of this.pendingForms.values()) {
      clearTimeout(pending.timer)
      this.handleFor(pending.sessionID)?.client.respond({
        id: pending.requestID,
        cancelled: true,
      })
    }
    this.pendingPermissions.clear()
    this.pendingForms.clear()
    this.turns.clear()
    await this.manager.close()
  }

  private async submit(
    sessionID: string,
    text: string,
    files: unknown[] | undefined,
    identity: PromptIdentity,
    item: ClaraSessionInboxInfo,
    action: 'prompt' | 'compact',
    delivery: 'steer' | 'queue' = 'steer',
    announce = true
  ): Promise<void> {
    const active = this.turns.get(sessionID)
    if (active?.busy) {
      const request = delivery === 'queue' ? 'follow_up' : 'steer'
      const { message, images } = composePrompt(text, files)
      try {
        await active.handle.client.request(
          { type: request, message, ...(images.length > 0 ? { images } : {}) },
          COMMAND_TIMEOUT_MS
        )
        active.pending.push(identity)
        if (delivery === 'queue' && announce) {
          active.queue.push({ item, identity, text: message, images, action })
          this.emit('session.inbox.enqueued', { sessionID, inboxID: item.id, item })
        } else if (announce) {
          this.emit('session.inbox.delivered', { sessionID, inboxID: item.id, item })
        }
        return
      } catch {
        // The run settled between the check and the request; start a new turn.
      }
    }

    const target = await this.sessions.target(sessionID)
    const handle = await this.manager.open(target)
    const turn = this.startTurn(handle, identity)
    if (action === 'compact') {
      if (announce) this.emit('session.inbox.delivered', { sessionID, inboxID: item.id, item })
      await this.compactNow(sessionID, undefined)
      return
    }
    const { message, images } = composePrompt(text, files)
    this.emit('session.execution.started', { sessionID })
    this.emit('session.status', { sessionID, status: { type: 'busy' } })
    if (announce) {
      this.emit('session.inbox.delivered', { sessionID, inboxID: item.id, item })
    }
    if (identity.kind === 'synthetic') {
      this.emit('session.synthetic', {
        sessionID,
        text,
        ...(identity.description ? { description: identity.description } : {}),
      })
    }
    void this.runPrompt(turn, message, images)
  }

  private startTurn(handle: PiSessionHandle, identity: PromptIdentity): ActiveTurn {
    const turn: ActiveTurn = {
      sessionID: handle.sessionID,
      handle,
      directory: handle.cwd,
      busy: true,
      synthetic: identity.kind === 'synthetic',
      interrupted: false,
      sawStart: false,
      endedSteps: new Set(),
      ordinals: new Map(),
      nextOrdinal: 0,
      completed: new Set(),
      tools: new Set(),
      toolByIndex: new Map(),
      pending: [identity],
      queue: [],
      compactionCommand: false,
    }
    this.turns.set(handle.sessionID, turn)
    this.manager.markBusy(handle, true)
    return turn
  }

  private async runPrompt(turn: ActiveTurn, message: string, images: PiImage[]): Promise<void> {
    try {
      const result = await turn.handle.client.request<{ disposition?: string }>(
        {
          type: 'prompt',
          message,
          ...(images.length > 0 ? { images } : {}),
        },
        PROMPT_TIMEOUT_MS
      )
      if (result?.disposition === 'handled') {
        // An extension command may start its own run with pi.sendMessage().
        // Give agent_start a moment to arrive before declaring the prompt done.
        const timer = setTimeout(() => {
          if (!turn.sawStart) this.settle(turn, false)
        }, 750)
        timer.unref?.()
      }
    } catch (cause) {
      this.fail(turn, cause)
    }
  }

  private async compactNow(sessionID: string, customInstructions?: string): Promise<void> {
    const target = await this.sessions.target(sessionID)
    const handle = await this.manager.open(target)
    const turn =
      this.turns.get(sessionID) ?? this.startTurn(handle, { id: randomUUID(), kind: 'user' })
    turn.busy = true
    turn.compactionCommand = true
    this.manager.markBusy(handle, true)
    this.emit('session.execution.started', { sessionID })
    this.emit('session.status', { sessionID, status: { type: 'busy' } })
    this.emit('session.compaction.started', { sessionID, reason: 'manual' })
    try {
      const result = await handle.client.request<{
        summary?: string
        usage?: Record<string, unknown>
      }>(
        {
          type: 'compact',
          ...(customInstructions ? { customInstructions } : {}),
        },
        5 * 60_000
      )
      this.emit('session.compaction.ended', {
        sessionID,
        reason: 'manual',
        text: result?.summary ?? 'Context compacted',
        cost: usageCost(result?.usage),
        tokens: usageTokens(result?.usage),
      })
      this.settle(turn, false)
    } catch (cause) {
      this.emit('session.compaction.failed', {
        sessionID,
        reason: 'manual',
        error: {
          type: 'pi_error',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      })
      this.fail(turn, cause)
    }
  }

  private handleFor(sessionID: string): PiSessionHandle | undefined {
    return this.manager.get(sessionID) ?? this.turns.get(sessionID)?.handle
  }

  private onEvent(handle: PiSessionHandle, event: PiRpcRecord): void {
    let turn = this.turns.get(handle.sessionID)
    if (!turn && event.type === 'agent_start') {
      turn = this.startTurn(handle, { id: `pi-auto-${Date.now()}`, kind: 'user' })
      this.emit('session.execution.started', { sessionID: turn.sessionID })
      this.emit('session.status', { sessionID: turn.sessionID, status: { type: 'busy' } })
    }
    if (!turn) return
    switch (event.type) {
      case 'agent_start':
        turn.busy = true
        turn.sawStart = true
        this.emit('session.status', { sessionID: turn.sessionID, status: { type: 'busy' } })
        return
      case 'message_start':
        this.onMessageStart(turn, event)
        return
      case 'message_update':
        this.onMessageUpdate(turn, event)
        return
      case 'message_end':
        this.onMessageEnd(turn, event)
        return
      case 'tool_execution_start':
        this.onToolStart(turn, event)
        return
      case 'tool_execution_update':
        this.onToolUpdate(turn, event)
        return
      case 'tool_execution_end':
        this.onToolEnd(turn, event)
        return
      case 'compaction_start':
        if (turn.compactionCommand) return
        this.emit('session.compaction.started', {
          sessionID: turn.sessionID,
          reason: event.reason === 'manual' ? 'manual' : 'auto',
        })
        return
      case 'compaction_end':
        if (turn.compactionCommand) return
        this.onCompactionEnd(turn, event)
        return
      case 'auto_retry_start':
        this.onRetryStart(turn, event)
        return
      case 'auto_retry_end':
        this.emit('session.status', { sessionID: turn.sessionID, status: { type: 'busy' } })
        return
      case 'agent_settled':
        this.settle(turn, event.aborted === true)
        return
      case 'session_info_changed':
        if (typeof event.name === 'string' && event.name.trim()) {
          this.emit('session.renamed', { sessionID: turn.sessionID, title: event.name })
          this.sessions.invalidateProjects()
        }
        return
      case 'extension_error':
        console.error(
          `[pi] extension error (${String(event.event ?? 'unknown')}): ${String(event.error ?? '')}`
        )
        return
      default:
        return
    }
  }

  private onMessageStart(turn: ActiveTurn, event: PiRpcRecord): void {
    const message = event.message
    if (!isRecord(message)) return
    if (message.role === 'user') {
      const timestamp = typeof message.timestamp === 'number' ? message.timestamp : undefined
      const identity = turn.pending.shift()
      if (identity && timestamp !== undefined) {
        this.sessions.rememberPrompt(turn.sessionID, identity, timestamp)
        const queued = turn.queue.findIndex((entry) => entry.identity.id === identity.id)
        if (queued >= 0) {
          const [entry] = turn.queue.splice(queued, 1)
          if (entry) {
            this.emit('session.inbox.delivered', {
              sessionID: turn.sessionID,
              inboxID: entry.item.id,
              item: entry.item,
            })
          }
        }
      }
      return
    }
    if (message.role !== 'assistant') return
    const assistantMessageID = assistantID(message)
    if (!assistantMessageID) return
    this.startStep(turn, assistantMessageID, modelOf(message, turn.handle.state.model))
  }

  private onMessageUpdate(turn: ActiveTurn, event: PiRpcRecord): void {
    const update = event.assistantMessageEvent
    if (!isRecord(update) || !turn.assistantMessageID) return
    const index = typeof update.contentIndex === 'number' ? update.contentIndex : 0
    const ordinal = this.ordinalFor(turn, index)
    switch (update.type) {
      case 'text_start':
        this.emit('session.text.started', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
        })
        return
      case 'text_delta':
        if (typeof update.delta !== 'string') return
        this.emit('session.text.delta', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
          delta: update.delta,
        })
        return
      case 'text_end':
        turn.completed.add(partKey(turn.assistantMessageID, index, 'text'))
        this.emit('session.text.ended', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
          text: typeof update.content === 'string' ? update.content : '',
        })
        return
      case 'thinking_start':
        this.emit('session.reasoning.started', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
        })
        return
      case 'thinking_delta':
        if (typeof update.delta !== 'string') return
        this.emit('session.reasoning.delta', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
          delta: update.delta,
        })
        return
      case 'thinking_end':
        turn.completed.add(partKey(turn.assistantMessageID, index, 'thinking'))
        this.emit('session.reasoning.ended', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          ordinal,
          text: typeof update.content === 'string' ? update.content : '',
        })
        return
      case 'toolcall_start': {
        const id = typeof update.id === 'string' ? update.id : undefined
        const name = typeof update.toolName === 'string' ? update.toolName : 'tool'
        if (!id) return
        turn.tools.add(id)
        turn.toolByIndex.set(index, id)
        this.emit('session.tool.input.started', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          id,
          name,
        })
        return
      }
      case 'toolcall_delta': {
        const id = turn.toolByIndex.get(index)
        if (!id || typeof update.delta !== 'string') return
        this.emit('session.tool.input.delta', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          id,
          delta: update.delta,
        })
        return
      }
      case 'toolcall_end': {
        const tool = isRecord(update.toolCall) ? update.toolCall : undefined
        const id = typeof tool?.id === 'string' ? tool.id : turn.toolByIndex.get(index)
        if (!id) return
        this.emit('session.tool.input.ended', {
          sessionID: turn.sessionID,
          assistantMessageID: turn.assistantMessageID,
          id,
          text: JSON.stringify(isRecord(tool?.arguments) ? tool.arguments : {}),
        })
        return
      }
      default:
        return
    }
  }

  private onMessageEnd(turn: ActiveTurn, event: PiRpcRecord): void {
    const message = event.message
    if (!isRecord(message) || message.role !== 'assistant') return
    const assistantMessageID = assistantID(message)
    if (!assistantMessageID) return
    this.startStep(turn, assistantMessageID, modelOf(message, turn.handle.state.model))
    const blocks = Array.isArray(message.content) ? message.content : []
    blocks.forEach((block, index) => {
      if (!isRecord(block)) return
      const ordinal = this.ordinalFor(turn, index)
      if (block.type === 'text' && typeof block.text === 'string') {
        if (turn.completed.has(partKey(assistantMessageID, index, 'text'))) return
        turn.completed.add(partKey(assistantMessageID, index, 'text'))
        this.emit('session.text.ended', {
          sessionID: turn.sessionID,
          assistantMessageID,
          ordinal,
          text: block.text,
        })
        return
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        if (turn.completed.has(partKey(assistantMessageID, index, 'thinking'))) return
        turn.completed.add(partKey(assistantMessageID, index, 'thinking'))
        this.emit('session.reasoning.ended', {
          sessionID: turn.sessionID,
          assistantMessageID,
          ordinal,
          text: block.thinking,
        })
        return
      }
      if (block.type === 'toolCall' && typeof block.id === 'string') {
        if (turn.tools.has(block.id)) return
        turn.tools.add(block.id)
        this.emit('session.tool.input.started', {
          sessionID: turn.sessionID,
          assistantMessageID,
          id: block.id,
          name: typeof block.name === 'string' ? block.name : 'tool',
        })
        this.emit('session.tool.input.ended', {
          sessionID: turn.sessionID,
          assistantMessageID,
          id: block.id,
          text: JSON.stringify(isRecord(block.arguments) ? block.arguments : {}),
        })
      }
    })
    const usage = isRecord(message.usage) ? message.usage : undefined
    const finish = finishOf(typeof message.stopReason === 'string' ? message.stopReason : undefined)
    if (!turn.endedSteps.has(assistantMessageID)) {
      turn.endedSteps.add(assistantMessageID)
      this.emit('session.step.ended', {
        sessionID: turn.sessionID,
        assistantMessageID,
        finish,
        ...(typeof message.stopReason === 'string' ? { rawFinish: message.stopReason } : {}),
        cost: usageCost(usage),
        tokens: usageTokens(usage),
      })
    }
    if (message.stopReason === 'error' && typeof message.errorMessage === 'string') {
      turn.failed = message.errorMessage
    }
  }

  private onToolStart(turn: ActiveTurn, event: PiRpcRecord): void {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    if (!id) return
    const assistantMessageID = turn.assistantMessageID ?? this.ensureToolStep(turn)
    const input = isRecord(event.args) ? event.args : {}
    turn.tools.add(id)
    this.emit('session.tool.called', {
      sessionID: turn.sessionID,
      assistantMessageID,
      id,
      input: input as Record<string, ClaraJsonValue>,
      executed: true,
    })
  }

  private onToolUpdate(turn: ActiveTurn, event: PiRpcRecord): void {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    if (!id || !turn.assistantMessageID) return
    const output = toolOutput(event.partialResult)
    if (!output) return
    this.emit('session.tool.progress', {
      sessionID: turn.sessionID,
      assistantMessageID: turn.assistantMessageID,
      id,
      metadata: { output },
    })
  }

  private onToolEnd(turn: ActiveTurn, event: PiRpcRecord): void {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    if (!id) return
    const assistantMessageID = turn.assistantMessageID ?? this.ensureToolStep(turn)
    const result = isRecord(event.result) ? event.result : undefined
    const content = toolContentOf(result?.content as PiMessage['content'])
    if (event.isError === true) {
      this.emit('session.tool.failed', {
        sessionID: turn.sessionID,
        assistantMessageID,
        id,
        error: {
          type: 'tool_error',
          message: messageText(result?.content as PiMessage['content']),
        },
        content,
        executed: true,
      })
      return
    }
    this.emit('session.tool.success', {
      sessionID: turn.sessionID,
      assistantMessageID,
      id,
      content,
      executed: true,
    })
  }

  private onCompactionEnd(turn: ActiveTurn, event: PiRpcRecord): void {
    const result = isRecord(event.result) ? event.result : undefined
    const reason = event.reason === 'manual' ? 'manual' : 'auto'
    if (!result) {
      this.emit('session.compaction.failed', {
        sessionID: turn.sessionID,
        reason,
        error: {
          type: 'pi_error',
          message:
            typeof event.errorMessage === 'string' ? event.errorMessage : 'Compaction failed',
        },
      })
      return
    }
    const usage = isRecord(result.usage) ? result.usage : undefined
    this.emit('session.compaction.ended', {
      sessionID: turn.sessionID,
      reason,
      text: typeof result.summary === 'string' ? result.summary : 'Context compacted',
      cost: usageCost(usage),
      tokens: usageTokens(usage),
    })
  }

  private onRetryStart(turn: ActiveTurn, event: PiRpcRecord): void {
    const attempt = typeof event.attempt === 'number' ? event.attempt : 1
    const message = typeof event.errorMessage === 'string' ? event.errorMessage : 'Retrying'
    const delay = typeof event.delayMs === 'number' ? event.delayMs : 1_000
    const assistantMessageID = turn.assistantMessageID ?? `pi-retry-${Date.now()}`
    this.emit('session.retry.scheduled', {
      sessionID: turn.sessionID,
      assistantMessageID,
      attempt,
      at: Date.now() + delay,
      error: { type: 'pi_retry', message },
    })
    this.emit('session.status', {
      sessionID: turn.sessionID,
      status: {
        type: 'retry',
        attempt,
        message,
        next: Date.now() + delay,
      },
    })
  }

  private onUiRequest(handle: PiSessionHandle, request: PiUiRequest): void {
    const turn = this.turns.get(handle.sessionID)
    if (!turn || this.closed) return
    const method = request.method
    if (method === 'confirm') {
      const title = typeof request.title === 'string' ? request.title : 'Confirm'
      const message = typeof request.message === 'string' ? request.message : ''
      const requestID = `pi-ui-${request.id}`
      const permission: ClaraPermissionRequest = {
        id: requestID,
        sessionID: handle.sessionID,
        action: 'extension',
        resources: [title],
        message: [title, message].filter(Boolean).join('\n\n'),
        metadata: { method: 'confirm', extensionRequestID: request.id },
      }
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestID)
        handle.client.respond({ id: request.id, cancelled: true })
        this.emit('permission.replied', {
          sessionID: handle.sessionID,
          requestID,
          reply: 'reject',
        })
      }, UI_TIMEOUT_MS)
      timer.unref?.()
      this.pendingPermissions.set(requestID, {
        request: permission,
        sessionID: handle.sessionID,
        directory: handle.cwd,
        requestID: request.id,
        timer,
      })
      this.emit('permission.asked', permission)
      return
    }
    if (method !== 'select' && method !== 'input' && method !== 'editor') return
    const form = uiForm(handle.sessionID, request)
    if (!form) return
    const timer = setTimeout(() => {
      this.pendingForms.delete(form.id)
      handle.client.respond({ id: request.id, cancelled: true })
      this.emit('form.cancelled', { id: form.id, sessionID: handle.sessionID })
    }, UI_TIMEOUT_MS)
    timer.unref?.()
    this.pendingForms.set(form.id, {
      form,
      sessionID: handle.sessionID,
      directory: handle.cwd,
      requestID: request.id,
      timer,
    })
    this.emit('form.created', { form })
  }

  private onExit(handle: PiSessionHandle): void {
    const turn = this.turns.get(handle.sessionID)
    if (!turn) return
    this.fail(turn, new Error('The Pi process exited'))
  }

  private settle(turn: ActiveTurn, aborted: boolean): void {
    if (!this.turns.has(turn.sessionID)) return
    const queuedCompact = turn.queue.find((entry) => entry.action === 'compact')
    this.turns.delete(turn.sessionID)
    this.manager.markBusy(turn.handle, false)
    this.cancelUiRequests(turn.sessionID, 'The run finished')
    if (turn.assistantMessageID && !turn.endedSteps.has(turn.assistantMessageID)) {
      turn.endedSteps.add(turn.assistantMessageID)
      this.emit('session.step.ended', {
        sessionID: turn.sessionID,
        assistantMessageID: turn.assistantMessageID,
        finish: 'stop',
        cost: 0,
        tokens: emptyTokens(),
      })
    }
    if (turn.interrupted || aborted) {
      this.emit('session.execution.interrupted', { sessionID: turn.sessionID, reason: 'user' })
    } else if (turn.failed) {
      this.emit('session.execution.failed', {
        sessionID: turn.sessionID,
        error: { type: 'pi_error', message: turn.failed },
      })
    } else {
      this.emit('session.execution.succeeded', { sessionID: turn.sessionID })
    }
    this.emit('session.status', { sessionID: turn.sessionID, status: { type: 'idle' } })
    this.emit('session.idle', { sessionID: turn.sessionID })
    void this.emitUsage(turn.sessionID)
    if (queuedCompact) {
      this.emit('session.inbox.delivered', {
        sessionID: turn.sessionID,
        inboxID: queuedCompact.item.id,
        item: queuedCompact.item,
      })
      this.afterSettle(() => this.compactNow(turn.sessionID, undefined))
    }
  }

  private fail(turn: ActiveTurn, cause: unknown): void {
    if (!this.turns.has(turn.sessionID)) return
    const message = cause instanceof Error ? cause.message : String(cause)
    this.turns.delete(turn.sessionID)
    this.manager.markBusy(turn.handle, false)
    this.cancelUiRequests(turn.sessionID, 'The run failed')
    if (turn.assistantMessageID && !turn.endedSteps.has(turn.assistantMessageID)) {
      turn.endedSteps.add(turn.assistantMessageID)
      this.emit('session.step.failed', {
        sessionID: turn.sessionID,
        assistantMessageID: turn.assistantMessageID,
        error: { type: 'pi_error', message },
      })
    }
    this.emit('session.execution.failed', {
      sessionID: turn.sessionID,
      error: { type: 'pi_error', message },
    })
    this.emit('session.status', { sessionID: turn.sessionID, status: { type: 'idle' } })
    this.emit('session.idle', { sessionID: turn.sessionID })
    void this.emitUsage(turn.sessionID)
  }

  private async emitUsage(sessionID: string): Promise<void> {
    try {
      const { session } = await this.sessions.read(sessionID)
      const usage = sessionUsage(session.entries)
      this.emit('session.usage.updated', {
        sessionID,
        cost: usage.cost,
        tokens: usage.tokens,
      })
    } catch {
      // Usage is best-effort; the next session read will refresh it.
    }
  }

  private startStep(
    turn: ActiveTurn,
    assistantMessageID: string,
    model: { id: string; providerID: string }
  ): void {
    if (turn.assistantMessageID === assistantMessageID) {
      turn.assistantModel = model
      return
    }
    if (turn.assistantMessageID && !turn.endedSteps.has(turn.assistantMessageID)) {
      turn.endedSteps.add(turn.assistantMessageID)
      this.emit('session.step.ended', {
        sessionID: turn.sessionID,
        assistantMessageID: turn.assistantMessageID,
        finish: 'tool-calls',
        cost: 0,
        tokens: emptyTokens(),
      })
    }
    turn.assistantMessageID = assistantMessageID
    turn.assistantModel = model
    turn.ordinals.clear()
    turn.nextOrdinal = 0
    turn.completed.clear()
    turn.tools.clear()
    turn.toolByIndex.clear()
    this.emit('session.step.started', {
      sessionID: turn.sessionID,
      assistantMessageID,
      agent: 'pi',
      model,
      started: Date.now(),
    })
  }

  private ensureToolStep(turn: ActiveTurn): string {
    const id = `pi-tools-${Date.now()}`
    this.startStep(turn, id, turn.assistantModel ?? modelOf({}, turn.handle.state.model))
    return id
  }

  private ordinalFor(turn: ActiveTurn, index: number): number {
    const existing = turn.ordinals.get(index)
    if (existing !== undefined) return existing
    const ordinal = turn.nextOrdinal++
    turn.ordinals.set(index, ordinal)
    return ordinal
  }

  private cancelUiRequests(sessionID: string, reason: string): void {
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.sessionID !== sessionID) continue
      clearTimeout(pending.timer)
      this.pendingPermissions.delete(id)
      this.handleFor(sessionID)?.client.respond({ id: pending.requestID, cancelled: true })
      this.emit('permission.replied', { sessionID, requestID: id, reply: 'reject' })
      console.error(`[pi] cancelled extension confirmation: ${reason}`)
    }
    for (const [id, pending] of this.pendingForms) {
      if (pending.sessionID !== sessionID) continue
      clearTimeout(pending.timer)
      this.pendingForms.delete(id)
      this.emit('form.cancelled', { id, sessionID })
      this.handleFor(sessionID)?.client.respond({ id: pending.requestID, cancelled: true })
    }
  }

  private afterSettle(action: () => Promise<void>): void {
    const timer = setTimeout(() => {
      void action().catch((cause: unknown) => {
        console.error(
          `[pi] deferred compaction failed: ${cause instanceof Error ? cause.message : String(cause)}`
        )
      })
    }, 0)
    timer.unref?.()
  }

  private emit<T extends ClaraEvent['type']>(
    type: T,
    data: Extract<ClaraEvent, { type: T }>['data']
  ): void {
    this.bus.publish({
      id: randomUUID(),
      type,
      created: Date.now(),
      data,
    } as Extract<ClaraEvent, { type: T }>)
  }
}

function assistantID(message: Record<string, unknown>): string | undefined {
  const timestamp = message.timestamp
  if (typeof timestamp !== 'number') return undefined
  return `pi-a-${timestamp}`
}

function modelOf(
  message: Record<string, unknown>,
  fallback?: { id: string; name: string; provider: string }
): { id: string; providerID: string } {
  return {
    id: typeof message.model === 'string' ? message.model : (fallback?.id ?? 'unknown'),
    providerID:
      typeof message.provider === 'string' ? message.provider : (fallback?.provider ?? 'pi'),
  }
}

function partKey(assistantMessageID: string, index: number, kind: string): string {
  return `${assistantMessageID}:${index}:${kind}`
}

function usageCost(usage: Record<string, unknown> | undefined): number {
  const cost = usage?.cost
  if (!isRecord(cost)) return 0
  return typeof cost.total === 'number' ? cost.total : 0
}

function usageTokens(usage: Record<string, unknown> | undefined): ClaraTokenUsage {
  if (!usage) return emptyTokens()
  return {
    input: numberOrZero(usage.input),
    output: numberOrZero(usage.output),
    reasoning: numberOrZero(usage.reasoning),
    cache: {
      read: numberOrZero(usage.cacheRead),
      write: numberOrZero(usage.cacheWrite),
    },
  }
}

function emptyTokens(): ClaraTokenUsage {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toolOutput(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  const text = messageText(result.content as PiMessage['content'])
  return text.trim() ? text : undefined
}

function uiForm(sessionID: string, request: PiUiRequest): ClaraForm | undefined {
  const id = `pi-form-${request.id}`
  const title =
    typeof request.title === 'string'
      ? request.title
      : request.method === 'select'
        ? 'Choose an option'
        : 'Enter a value'
  if (request.method === 'select') {
    const options = Array.isArray(request.options)
      ? request.options.filter((option): option is string => typeof option === 'string')
      : []
    if (options.length === 0) return undefined
    return {
      id,
      sessionID,
      title,
      fields: [
        {
          key: 'value',
          type: 'string',
          title,
          ...(typeof request.message === 'string' ? { description: request.message } : {}),
          options: options.map((option) => ({ value: option, label: option })),
        },
      ],
    }
  }
  return {
    id,
    sessionID,
    title,
    fields: [
      {
        key: 'value',
        type: 'string',
        title,
        ...(typeof request.message === 'string' ? { description: request.message } : {}),
        ...(typeof request.placeholder === 'string' ? { placeholder: request.placeholder } : {}),
        ...(typeof request.prefill === 'string' ? { default: request.prefill } : {}),
      },
    ],
  }
}

function boundaryIndex(
  branch: ReturnType<typeof activeBranch>,
  messageID: string,
  prompts: Map<number, PromptIdentity>
): number {
  let target: string | undefined
  if (messageID.startsWith('pi-a-')) {
    target = messageID.slice('pi-a-'.length)
  } else if (messageID.startsWith('pi-u-')) {
    target = messageID.slice('pi-u-'.length)
  } else {
    for (const [timestamp, identity] of prompts) {
      if (identity.id === messageID) {
        target = String(timestamp)
        break
      }
    }
  }
  if (target && /^\d+$/.test(target)) {
    const timestamp = Number(target)
    const index = branch.findIndex(
      (entry) => entry.type === 'message' && entry.message?.timestamp === timestamp
    )
    if (index >= 0) return index
  }
  const direct = branch.findIndex((entry) => entry.id === messageID)
  if (direct >= 0) return direct
  return branch.length
}

function composePrompt(
  text: string,
  files: unknown[] | undefined
): { message: string; images: PiImage[] } {
  const images: PiImage[] = []
  const notes: string[] = []
  for (const file of files ?? []) {
    if (!isRecord(file)) continue
    const uri = typeof file.uri === 'string' ? file.uri : undefined
    if (!uri) continue
    const path = uri.startsWith('file://') ? fileURLToPath(uri) : uri
    const mime = typeof file.mime === 'string' ? file.mime : ''
    try {
      const stats = statSync(path)
      if (stats.size > 10 * 1024 * 1024) {
        notes.push(`[attached file ${path} is too large to include]`)
        continue
      }
      if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(path)) {
        const data = readFileSync(path).toString('base64')
        images.push({
          type: 'image',
          data,
          mimeType: mime.startsWith('image/') ? mime : 'image/png',
        })
        continue
      }
      if (mime.startsWith('text/') || /\.(md|txt|json|ya?ml|ts|tsx|js|jsx|css|html)$/i.test(path)) {
        const content = readFileSync(path, 'utf8').slice(0, 256 * 1024)
        notes.push(`<file path="${path}">\n${content}\n</file>`)
        continue
      }
      notes.push(`[attached file: ${path}${mime ? ` (${mime})` : ''}]`)
    } catch {
      notes.push(`[attached file ${uri} could not be read]`)
    }
  }
  return {
    message: [text, ...notes].filter(Boolean).join('\n\n'),
    images,
  }
}

function filesPayload(files: unknown[]): NonNullable<ClaraSessionInboxUser['payload']['files']> {
  return files.flatMap((file) => {
    if (!isRecord(file)) return []
    const uri = typeof file.uri === 'string' ? file.uri : undefined
    if (!uri) return []
    return [
      {
        data: '',
        mime: typeof file.mime === 'string' ? file.mime : 'application/octet-stream',
        source: { type: 'uri' as const, uri },
        ...(typeof file.name === 'string' ? { name: file.name } : {}),
      },
    ]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
