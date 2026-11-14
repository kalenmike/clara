import { randomUUID } from 'node:crypto'
import type {
  ClaraEvent,
  ClaraJsonValue,
  ClaraForm,
  ClaraFormField,
  ClaraFormValue,
  ClaraModelRef,
  ClaraPermissionRequest,
  ClaraSessionInboxCompaction,
  ClaraSessionInboxItem,
  ClaraSessionInboxSynthetic,
  ClaraSessionInboxUser,
  ClaraTokenUsage,
} from '@clara/api-contract'
import type { ClaudeConfig } from './config.ts'
import { AdapterError } from './errors.ts'
import type { EventBus } from './events.ts'
import type { ClaudeProvider } from './provider.ts'
import type {
  ClaudeGateway,
  ClaudePermissionDecision,
  ClaudePermissionRequest,
  ClaudeTurn,
  ClaudeTurnEvent,
  ClaudeUsage,
} from './sdk.ts'
import type { SessionService } from './sessions.ts'
import { emptyTokens } from './store.ts'

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
}

type TurnInput = {
  text: string
  files: string[]
  model?: string
  agent: string
  synthetic: boolean
  compact: boolean
  syntheticDescription?: string
  syntheticMetadata?: Record<string, ClaraJsonValue>
}

type Queued = {
  item: ClaraSessionInboxItem
  input: TurnInput
}

type ToolOwner = {
  assistantMessageID: string
  ordinal: number
}

type ActiveTurn = {
  sessionId: string
  directory: string
  model?: string
  provider: ClaudeProvider
  agent: string
  synthetic: boolean
  compact: boolean
  turn?: ClaudeTurn
  assistantMessageID?: string
  nextOrdinal: Map<string, number>
  ordinals: Map<string, number>
  streamed: Set<string>
  toolOwners: Map<string, ToolOwner>
  deniedTools: Set<string>
  endedSteps: Set<string>
  queue: Queued[]
  interrupted: boolean
  finished: boolean
  done: Deferred<void>
}

type PendingForm = {
  form: ClaraForm
  questions: QuestionInput[]
  sessionId: string
  resolve: (decision: ClaudePermissionDecision) => void
}

type QuestionInput = {
  question: string
  header?: string
  multiSelect?: boolean
  options?: { label: string; description?: string }[]
}

type PendingPermission = {
  request: ClaraPermissionRequest
  input: Record<string, unknown>
  sessionId: string
  directory: string
  toolUseID: string
  suggestions?: unknown[]
  resolve: (decision: ClaudePermissionDecision) => void
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * Owns per-session prompt queues, live turns, permission prompts, and the
 * translation from Agent SDK events to Clara events.
 */
export class ClaudeRuntime {
  private readonly claude: ClaudeGateway
  private readonly sessions: SessionService
  private readonly bus: EventBus
  private readonly config: ClaudeConfig
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly pending = new Map<string, PendingPermission>()
  private readonly pendingForms = new Map<string, PendingForm>()
  private readonly lastFinish = new Map<
    string,
    'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown'
  >()
  private closed = false

  constructor(
    claude: ClaudeGateway,
    sessions: SessionService,
    bus: EventBus,
    config: ClaudeConfig
  ) {
    this.claude = claude
    this.sessions = sessions
    this.bus = bus
    this.config = config
  }

  private modelFor(session: { model?: { id: string } }): string | undefined {
    return session.model?.id ?? this.config.model ?? this.claude.defaultModel()
  }

  async prompt(sessionId: string, input: PromptInput): Promise<ClaraSessionInboxUser> {
    const session = await this.sessions.get(sessionId)
    const directory = session.location.directory
    if (!directory) throw new AdapterError(400, 'invalid_request', 'The session has no directory')
    const delivery = input.delivery ?? 'steer'
    const item: ClaraSessionInboxUser = {
      id: randomUUID(),
      sessionID: sessionId,
      type: 'user',
      delivery,
      payload: {
        text: input.text,
        ...(input.files ? { files: filesPayload(input.files) } : {}),
      },
      time: { created: Date.now() },
    }
    const model = this.modelFor(session)
    const turnInput: TurnInput = {
      text: input.text,
      files: fileUris(input.files),
      ...(model ? { model } : {}),
      agent: session.agent ?? this.config.agent ?? 'claude',
      synthetic: false,
      compact: false,
    }

    const active = this.activeTurns.get(sessionId)
    if (active) {
      if (delivery === 'queue' || !active.turn || active.synthetic) {
        active.queue.push({ item, input: turnInput })
        this.emit('session.inbox.enqueued', { sessionID: sessionId, inboxID: item.id, item })
      } else {
        active.turn.push({
          text: turnInput.text,
          files: turnInput.files,
          priority: 'next',
        })
        this.emit('session.inbox.delivered', { sessionID: sessionId, inboxID: String(item.id) })
      }
      return item
    }

    void this.start(sessionId, directory, turnInput, item)
    return item
  }

  async synthetic(sessionId: string, input: SyntheticInput): Promise<ClaraSessionInboxSynthetic> {
    const session = await this.sessions.get(sessionId)
    const directory = session.location.directory
    if (!directory) throw new AdapterError(400, 'invalid_request', 'The session has no directory')
    const delivery = input.delivery ?? 'steer'
    const item: ClaraSessionInboxSynthetic = {
      id: randomUUID(),
      sessionID: sessionId,
      type: 'synthetic',
      delivery,
      payload: {
        text: input.text,
        ...(input.description ? { description: input.description } : {}),
      },
      time: { created: Date.now() },
    }
    const turnInput: TurnInput = {
      text: input.text,
      files: [],
      agent: session.agent ?? this.config.agent ?? 'claude',
      synthetic: true,
      compact: false,
      ...(input.description ? { syntheticDescription: input.description } : {}),
    }
    const active = this.activeTurns.get(sessionId)
    if (active) {
      active.queue.push({ item, input: turnInput })
      this.emit('session.inbox.enqueued', { sessionID: sessionId, inboxID: item.id, item })
    } else {
      void this.start(sessionId, directory, turnInput, item)
    }
    return item
  }

  async compact(sessionId: string, input: CompactInput): Promise<ClaraSessionInboxCompaction> {
    const session = await this.sessions.get(sessionId)
    const directory = session.location.directory
    if (!directory) throw new AdapterError(400, 'invalid_request', 'The session has no directory')
    const delivery = input.delivery ?? 'queue'
    const item: ClaraSessionInboxCompaction = {
      id: randomUUID(),
      sessionID: sessionId,
      type: 'compaction',
      delivery,
      payload: {},
      time: { created: Date.now() },
    }
    const model = this.modelFor(session)
    const turnInput: TurnInput = {
      text: '/compact',
      files: [],
      ...(model ? { model } : {}),
      agent: session.agent ?? this.config.agent ?? 'claude',
      synthetic: false,
      compact: true,
    }
    const active = this.activeTurns.get(sessionId)
    if (active) {
      active.queue.push({ item, input: turnInput })
      this.emit('session.inbox.enqueued', { sessionID: sessionId, inboxID: item.id, item })
    } else {
      void this.start(sessionId, directory, turnInput, item)
    }
    return item
  }

  async command(sessionId: string, input: CommandInput): Promise<void> {
    const text = `/${input.name}${input.text?.trim() ? ` ${input.text}` : ''}`
    await this.prompt(sessionId, {
      text,
      ...(input.files ? { files: input.files } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    })
  }

  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    const active = this.activeTurns.get(sessionId)
    if (!active?.turn) return { interrupted: false }
    active.interrupted = true
    await active.turn.interrupt()
    return { interrupted: true }
  }

  async setModel(sessionId: string, model: ClaraModelRef): Promise<void> {
    const session = await this.sessions.get(sessionId)
    const directory = session.location.directory
    if (!directory) throw new AdapterError(400, 'invalid_request', 'The session has no directory')
    this.sessions.setSelection(sessionId, { directory, model })
    const active = this.activeTurns.get(sessionId)
    if (active?.turn) {
      await active.turn.setModel(model.id)
      active.model = model.id
    }
    this.emit('session.model.selected', {
      sessionID: sessionId,
      model,
      ...(session.model ? { previous: session.model } : {}),
    })
  }

  async setAgent(sessionId: string, agent: string): Promise<void> {
    const session = await this.sessions.get(sessionId)
    const directory = session.location.directory
    if (!directory) throw new AdapterError(400, 'invalid_request', 'The session has no directory')
    this.sessions.setSelection(sessionId, { directory, agent })
    this.emit('session.agent.selected', {
      sessionID: sessionId,
      agent,
      ...(session.agent ? { previous: session.agent } : {}),
    })
  }

  activeSessions(): Record<string, { type: 'running' }> {
    const result: Record<string, { type: 'running' }> = {}
    for (const active of this.activeTurns.values()) {
      if (!active.synthetic) result[active.sessionId] = { type: 'running' }
    }
    return result
  }

  inbox(sessionId: string): ClaraSessionInboxItem[] {
    return this.activeTurns.get(sessionId)?.queue.map((entry) => entry.item) ?? []
  }

  cancelInbox(sessionId: string, inboxID: string): void {
    const active = this.activeTurns.get(sessionId)
    if (!active) return
    const index = active.queue.findIndex((entry) => entry.item.id === inboxID)
    if (index < 0) return
    active.queue.splice(index, 1)
    this.emit('session.inbox.cancelled', { sessionID: sessionId, inboxID })
  }

  permissions(directory?: string): ClaraPermissionRequest[] {
    const requests: ClaraPermissionRequest[] = []
    for (const pending of this.pending.values()) {
      if (directory && pending.directory !== directory) continue
      requests.push(pending.request)
    }
    return requests
  }

  async replyPermission(
    sessionId: string,
    requestID: string,
    decision: 'once' | 'always' | 'reject',
    message?: string
  ): Promise<void> {
    const pending = this.pending.get(requestID)
    if (!pending || pending.sessionId !== sessionId) {
      throw new AdapterError(404, 'PermissionNotFoundError', 'That permission request is gone')
    }
    this.pending.delete(requestID)
    this.emit('permission.replied', {
      sessionID: sessionId,
      requestID,
      reply: decision,
    })
    if (decision === 'reject') {
      pending.resolve({ behavior: 'deny', message: message ?? 'The user rejected the action' })
      return
    }
    const permissions =
      decision === 'always' && pending.suggestions
        ? pending.suggestions.filter(
            (suggestion) => isRecord(suggestion) && suggestion.destination === 'localSettings'
          )
        : undefined
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input,
      ...(permissions && permissions.length > 0 ? { updatedPermissions: permissions } : {}),
    })
  }

  forms(sessionId: string): ClaraForm[] {
    return [...this.pendingForms.values()]
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.form)
  }

  async replyForm(
    sessionId: string,
    formID: string,
    answer: Record<string, ClaraFormValue>
  ): Promise<void> {
    const pending = this.pendingForms.get(formID)
    if (!pending || pending.sessionId !== sessionId) {
      throw new AdapterError(404, 'FormNotFoundError', 'That question is no longer waiting')
    }
    this.pendingForms.delete(formID)
    this.emit('form.replied', { id: formID, sessionID: sessionId, answer })
    const answers: Record<string, string | string[]> = {}
    for (let index = 0; index < pending.questions.length; index += 1) {
      const question = pending.questions[index]
      if (!question) continue
      const value = answer[`q${index}`]
      if (value === undefined) continue
      answers[question.question] = question.multiSelect
        ? Array.isArray(value)
          ? value
          : [String(value)]
        : Array.isArray(value)
          ? value.join(', ')
          : String(value)
    }
    pending.resolve({
      behavior: 'allow',
      updatedInput: { questions: pending.questions, answers },
    })
  }

  async cancelForm(sessionId: string, formID: string): Promise<void> {
    const pending = this.pendingForms.get(formID)
    if (!pending || pending.sessionId !== sessionId) {
      throw new AdapterError(404, 'FormNotFoundError', 'That question is no longer waiting')
    }
    this.pendingForms.delete(formID)
    this.emit('form.cancelled', { id: formID, sessionID: sessionId })
    pending.resolve({ behavior: 'deny', message: 'The user dismissed the question' })
  }

  close(): void {
    this.closed = true
    for (const pending of this.pendingForms.values()) {
      pending.resolve({ behavior: 'deny', message: 'The adapter is shutting down' })
    }
    this.pendingForms.clear()
    for (const pending of this.pending.values()) {
      pending.resolve({ behavior: 'deny', message: 'The adapter is shutting down' })
    }
    this.pending.clear()
    for (const active of this.activeTurns.values()) {
      active.finished = true
      active.turn?.close()
      active.done.resolve()
    }
    this.activeTurns.clear()
  }

  private async start(
    sessionId: string,
    directory: string,
    input: TurnInput,
    item: ClaraSessionInboxItem
  ): Promise<void> {
    const active: ActiveTurn = {
      sessionId,
      directory,
      ...(input.model ? { model: input.model } : {}),
      provider: this.claude.provider(),
      agent: input.agent,
      synthetic: input.synthetic,
      compact: input.compact,
      nextOrdinal: new Map(),
      ordinals: new Map(),
      streamed: new Set(),
      toolOwners: new Map(),
      deniedTools: new Set(),
      endedSteps: new Set(),
      queue: [],
      interrupted: false,
      finished: false,
      done: deferred<void>(),
    }
    this.activeTurns.set(sessionId, active)

    if (!active.synthetic) {
      this.emit('session.execution.started', { sessionID: sessionId })
      this.emit('session.status', { sessionID: sessionId, status: { type: 'busy' } })
    }
    this.emit('session.inbox.delivered', { sessionID: sessionId, inboxID: String(item.id) })
    if (active.synthetic) {
      this.emit('session.synthetic', {
        sessionID: sessionId,
        text: input.text,
        ...(input.syntheticDescription ? { description: input.syntheticDescription } : {}),
        ...(input.syntheticMetadata ? { metadata: input.syntheticMetadata } : {}),
      })
    }
    if (active.compact) {
      this.emit('session.compaction.started', { sessionID: sessionId, reason: 'manual' })
    }

    try {
      const turn = await this.claude.startTurn({
        sessionId,
        directory,
        text: input.text,
        ...(input.files.length > 0 ? { files: input.files } : {}),
        ...(input.model ? { model: input.model } : {}),
        agent: input.agent,
        synthetic: input.synthetic,
        signal: new AbortController().signal,
        onEvent: (event) => this.onEvent(active, event),
        onPermission: (request) => this.onPermission(active, request),
        onStderr: (chunk) => {
          if (process.env.CLARA_ADAPTER_DEBUG === '1') console.error(`[claude] ${chunk}`)
        },
      })
      active.turn = turn
      if (active.finished) turn.close()
      if (active.synthetic) {
        const timer = setTimeout(() => {
          active.turn?.close()
          active.done.resolve()
        }, 750)
        timer.unref?.()
      }
    } catch (cause) {
      this.fail(active, cause)
    }

    await active.done.promise
    this.activeTurns.delete(sessionId)
    this.lastFinish.delete(sessionId)
    this.cancelPermissions(active)
    const next = this.closed ? undefined : active.queue.shift()
    if (next) {
      void this.start(sessionId, directory, next.input, next.item)
    }
  }

  private onEvent(active: ActiveTurn, event: ClaudeTurnEvent): void {
    if (event.type === 'result') {
      this.finish(active, event)
      return
    }
    if (active.synthetic) return

    switch (event.type) {
      case 'init':
        active.model = event.model
        active.provider = event.provider
        return
      case 'message-start':
        active.streamed.add(event.assistantMessageID)
        this.startStep(active, event.assistantMessageID, event.model)
        return
      case 'text-started':
        active.streamed.add(event.assistantMessageID)
        this.emit('session.text.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
        })
        return
      case 'text-delta':
        this.emit('session.text.delta', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
          delta: event.delta,
        })
        return
      case 'text-ended':
        this.emit('session.text.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
          text: event.text ?? '',
        })
        return
      case 'reasoning-started':
        active.streamed.add(event.assistantMessageID)
        this.emit('session.reasoning.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
        })
        return
      case 'reasoning-delta':
        this.emit('session.reasoning.delta', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
          delta: event.delta,
        })
        return
      case 'reasoning-ended':
        this.emit('session.reasoning.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal: this.ordinalFor(active, event.assistantMessageID, event.ordinal),
          text: event.text ?? '',
        })
        return
      case 'tool-input-started': {
        active.streamed.add(event.assistantMessageID)
        this.startStep(active, event.assistantMessageID, active.model ?? 'default')
        const ordinal = this.ordinalFor(active, event.assistantMessageID, event.index)
        active.toolOwners.set(event.toolID, {
          assistantMessageID: event.assistantMessageID,
          ordinal,
        })
        this.emit('session.tool.input.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: event.toolID,
          name: event.name,
        })
        return
      }
      case 'tool-input-delta':
        this.emit('session.tool.input.delta', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: event.toolID,
          delta: event.delta,
        })
        return
      case 'tool-input-ended':
        this.emit('session.tool.input.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: event.toolID,
          text: event.text,
        })
        return
      case 'tool-called':
        this.emit('session.tool.called', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: event.toolID,
          input: event.input as Record<string, ClaraJsonValue>,
          executed: !active.deniedTools.has(event.toolID),
          ...(active.deniedTools.has(event.toolID)
            ? {
                native: {
                  denied: true,
                },
              }
            : {}),
        })
        return
      case 'assistant':
        this.assistant(active, event)
        return
      case 'tool-result':
        this.toolResult(active, event.toolID, event.content, event.isError)
        return
      case 'compact':
        this.emit('session.compaction.ended', {
          sessionID: active.sessionId,
          reason: event.trigger,
          text: 'Context compacted',
        })
        return
      case 'error':
        this.fail(active, new Error(event.message))
        return
      default:
        return
    }
  }

  private startStep(active: ActiveTurn, assistantMessageID: string, model: string): void {
    if (active.assistantMessageID === assistantMessageID) return
    if (active.assistantMessageID && !active.endedSteps.has(active.assistantMessageID)) {
      this.emit('session.step.ended', {
        sessionID: active.sessionId,
        assistantMessageID: active.assistantMessageID,
        finish: 'tool-calls',
        cost: 0,
        tokens: emptyTokens(),
      })
      active.endedSteps.add(active.assistantMessageID)
    }
    active.assistantMessageID = assistantMessageID
    this.emit('session.step.started', {
      sessionID: active.sessionId,
      assistantMessageID,
      agent: active.agent,
      model: { id: model, providerID: active.provider.id },
      started: Date.now(),
    })
  }

  private assistant(
    active: ActiveTurn,
    event: Extract<ClaudeTurnEvent, { type: 'assistant' }>
  ): void {
    this.startStep(active, event.assistantMessageID, event.model)
    this.lastFinish.set(active.sessionId, finishOf(event.stopReason))
    if (active.streamed.has(event.assistantMessageID)) return

    event.content.forEach((block, index) => {
      const ordinal = this.ordinalFor(active, event.assistantMessageID, index)
      if (block.type === 'text') {
        this.emit('session.text.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal,
        })
        this.emit('session.text.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal,
          text: block.text,
        })
      } else if (block.type === 'thinking') {
        this.emit('session.reasoning.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal,
        })
        this.emit('session.reasoning.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          ordinal,
          text: block.text,
        })
      } else {
        active.toolOwners.set(block.id, {
          assistantMessageID: event.assistantMessageID,
          ordinal,
        })
        this.emit('session.tool.input.started', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: block.id,
          name: block.name,
        })
        this.emit('session.tool.input.ended', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: block.id,
          text: JSON.stringify(block.input),
        })
        this.emit('session.tool.called', {
          sessionID: active.sessionId,
          assistantMessageID: event.assistantMessageID,
          id: block.id,
          input: block.input as Record<string, ClaraJsonValue>,
          executed: !active.deniedTools.has(block.id),
        })
      }
    })
  }

  private toolResult(active: ActiveTurn, toolID: string, content: string, isError: boolean): void {
    const owner = active.toolOwners.get(toolID)
    if (!owner) return
    const text = truncate(content)
    if (isError) {
      this.emit('session.tool.failed', {
        sessionID: active.sessionId,
        assistantMessageID: owner.assistantMessageID,
        id: toolID,
        error: { type: 'tool_error', message: text || 'The tool failed' },
        ...(text ? { content: [{ type: 'text' as const, text }] } : {}),
        executed: true,
      })
    } else {
      this.emit('session.tool.success', {
        sessionID: active.sessionId,
        assistantMessageID: owner.assistantMessageID,
        id: toolID,
        content: [{ type: 'text' as const, text }],
        executed: true,
      })
    }
  }

  private async onPermission(
    active: ActiveTurn,
    request: ClaudePermissionRequest
  ): Promise<ClaudePermissionDecision> {
    if (request.toolName === 'AskUserQuestion') {
      return this.askUserQuestion(active, request)
    }
    const owner = active.toolOwners.get(request.toolUseID)
    const claraRequest: ClaraPermissionRequest = {
      id: randomUUID(),
      sessionID: active.sessionId,
      action: request.toolName,
      resources: permissionResources(request.toolName, request.input),
      metadata: {
        input: request.input as Record<string, ClaraJsonValue>,
        ...(request.title ? { title: request.title } : {}),
        ...(request.description ? { description: request.description } : {}),
      },
      source: {
        type: 'tool',
        messageID: owner?.assistantMessageID ?? active.assistantMessageID ?? '',
        id: request.toolUseID,
      },
      ...(request.title ? { message: request.title } : {}),
    }
    const waiting = deferred<ClaudePermissionDecision>()
    this.pending.set(claraRequest.id, {
      request: claraRequest,
      input: request.input,
      sessionId: active.sessionId,
      directory: active.directory,
      toolUseID: request.toolUseID,
      ...(request.suggestions ? { suggestions: request.suggestions } : {}),
      resolve: waiting.resolve,
    })
    this.emit('permission.asked', claraRequest)
    return waiting.promise
  }

  private finish(active: ActiveTurn, result: Extract<ClaudeTurnEvent, { type: 'result' }>): void {
    if (active.finished) return
    active.finished = true
    if (active.assistantMessageID && !active.endedSteps.has(active.assistantMessageID)) {
      this.emit('session.step.ended', {
        sessionID: active.sessionId,
        assistantMessageID: active.assistantMessageID,
        finish:
          result.errors.length > 0 ? 'error' : (this.lastFinish.get(active.sessionId) ?? 'stop'),
        cost: result.costUsd,
        tokens: claraTokens(result.usage),
      })
      active.endedSteps.add(active.assistantMessageID)
    }

    const tokens = tokensFromResult(result)
    const outcome =
      result.aborted || active.interrupted
        ? 'interrupted'
        : result.subtype === 'success' && result.errors.length === 0
          ? 'succeeded'
          : 'failed'
    const error = result.errors.join('\n') || `Claude Code stopped: ${result.subtype}`
    const recorded = this.sessions.recordTurn(active.sessionId, {
      directory: active.directory,
      costUsd: result.costUsd,
      tokens,
      outcome,
      started: true,
      ...(active.model ? { model: active.model } : {}),
      providerID: active.provider.id,
      agent: active.agent,
      ...(outcome === 'failed' ? { error } : {}),
    })
    this.emit('session.usage.updated', {
      sessionID: active.sessionId,
      cost: recorded.cost,
      tokens: recorded.tokens,
    })
    if (outcome === 'interrupted') {
      this.emit('session.execution.interrupted', {
        sessionID: active.sessionId,
        reason: 'user',
      })
    } else if (outcome === 'failed') {
      this.emit('session.execution.failed', {
        sessionID: active.sessionId,
        error: { type: result.subtype, message: error },
      })
    } else {
      this.emit('session.execution.succeeded', { sessionID: active.sessionId })
    }
    this.emit('session.idle', { sessionID: active.sessionId })
    this.emit('session.status', { sessionID: active.sessionId, status: { type: 'idle' } })
    active.turn?.close()
    active.done.resolve()
  }

  private fail(active: ActiveTurn, cause: unknown): void {
    if (active.finished) return
    active.finished = true
    const message = cause instanceof Error ? cause.message : String(cause)
    if (active.assistantMessageID) {
      this.emit('session.step.failed', {
        sessionID: active.sessionId,
        assistantMessageID: active.assistantMessageID,
        error: { type: 'claude_error', message },
      })
    }
    this.sessions.recordTurn(active.sessionId, {
      directory: active.directory,
      costUsd: 0,
      tokens: emptyTokens(),
      outcome: 'failed',
      started: true,
      ...(active.model ? { model: active.model } : {}),
      providerID: active.provider.id,
      agent: active.agent,
      error: message,
    })
    this.emit('session.execution.failed', {
      sessionID: active.sessionId,
      error: { type: 'claude_error', message },
    })
    this.emit('session.idle', { sessionID: active.sessionId })
    this.emit('session.status', { sessionID: active.sessionId, status: { type: 'idle' } })
    active.done.resolve()
  }

  private askUserQuestion(
    active: ActiveTurn,
    request: ClaudePermissionRequest
  ): Promise<ClaudePermissionDecision> {
    const questions = questionInputs(request.input)
    if (questions.length === 0) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'Claude asked an invalid question',
      })
    }
    const formID = randomUUID()
    const fields: ClaraFormField[] = questions.map((question, index) => {
      const options = (question.options ?? []).map((option) => ({
        value: option.label,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      }))
      if (question.multiSelect) {
        return {
          type: 'multiselect',
          key: `q${index}`,
          title: question.header ?? `Question ${index + 1}`,
          description: question.question,
          required: true,
          options,
          custom: true,
        }
      }
      return {
        type: 'string',
        key: `q${index}`,
        title: question.header ?? `Question ${index + 1}`,
        description: question.question,
        required: true,
        options,
        custom: true,
      }
    })
    const form: ClaraForm = {
      id: formID,
      sessionID: active.sessionId,
      title: request.title ?? 'Claude Code needs input',
      fields: fields as [ClaraFormField, ...ClaraFormField[]],
    }
    const waiting = deferred<ClaudePermissionDecision>()
    this.pendingForms.set(formID, {
      form,
      questions,
      sessionId: active.sessionId,
      resolve: waiting.resolve,
    })
    this.emit('form.created', { form })
    return waiting.promise
  }

  private cancelPermissions(active: ActiveTurn): void {
    for (const [id, pending] of this.pendingForms) {
      if (pending.sessionId !== active.sessionId) continue
      this.pendingForms.delete(id)
      this.emit('form.cancelled', { id, sessionID: active.sessionId })
      pending.resolve({
        behavior: 'deny',
        message: 'The run ended before the question was answered',
      })
    }
    for (const [id, pending] of this.pending) {
      if (pending.sessionId !== active.sessionId) continue
      this.pending.delete(id)
      pending.resolve({
        behavior: 'deny',
        message: 'The run ended before the request was answered',
      })
    }
  }

  private ordinalFor(active: ActiveTurn, assistantMessageID: string, index: number): number {
    const key = `${assistantMessageID}:${index}`
    const existing = active.ordinals.get(key)
    if (existing !== undefined) return existing
    const next = active.nextOrdinal.get(assistantMessageID) ?? 0
    active.ordinals.set(key, next)
    active.nextOrdinal.set(assistantMessageID, next + 1)
    return next
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

function questionInputs(input: Record<string, unknown>): QuestionInput[] {
  const questions = input.questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((question) => {
    if (!isRecord(question) || typeof question.question !== 'string') return []
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => {
          if (!isRecord(option) || typeof option.label !== 'string') return []
          return [
            {
              label: option.label,
              ...(typeof option.description === 'string'
                ? { description: option.description }
                : {}),
            },
          ]
        })
      : []
    return [
      {
        question: question.question,
        ...(typeof question.header === 'string' ? { header: question.header } : {}),
        ...(question.multiSelect === true ? { multiSelect: true } : {}),
        ...(options.length > 0 ? { options } : {}),
      },
    ]
  })
}

function permissionResources(toolName: string, input: Record<string, unknown>): string[] {
  const candidates = [
    input.command,
    input.file_path,
    input.path,
    input.pattern,
    input.url,
    input.query,
  ]
  const found = candidates.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  if (found.length > 0) return found.map(truncate)
  return [toolName]
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

function fileUris(files: unknown[] | undefined): string[] {
  if (!files) return []
  return files.flatMap((file) => {
    if (!isRecord(file)) return []
    return typeof file.uri === 'string' ? [file.uri] : []
  })
}

function tokensFromResult(result: Extract<ClaudeTurnEvent, { type: 'result' }>): ClaraTokenUsage {
  const models = Object.values(result.modelUsage)
  if (models.length === 0) return claraTokens(result.usage)
  return models.reduce(
    (total, model) => ({
      input: total.input + model.input,
      output: total.output + model.output,
      reasoning: total.reasoning + model.reasoning,
      cache: {
        read: total.cache.read + model.cacheRead,
        write: total.cache.write + model.cacheWrite,
      },
    }),
    emptyTokens()
  )
}

function claraTokens(usage: ClaudeUsage | undefined): ClaraTokenUsage {
  if (!usage) return emptyTokens()
  return {
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cache: { read: usage.cacheRead, write: usage.cacheWrite },
  }
}

function finishOf(
  reason: string | undefined
): 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown' {
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

function truncate(value: string, max = 48_000): string {
  return value.length > max
    ? `${value.slice(0, max)}\n[truncated ${value.length - max} characters]`
    : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
