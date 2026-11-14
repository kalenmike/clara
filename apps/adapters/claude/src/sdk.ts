import { randomUUID } from 'node:crypto'
import type { AdapterProbe } from '@clara/adapter-runtime'
import type { ClaraModel } from '@clara/api-contract'
import {
  deleteSession as sdkDeleteSession,
  forkSession as sdkForkSession,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  listSessions as sdkListSessions,
  query,
  renameSession as sdkRenameSession,
  type CanUseTool,
  type ModelInfo,
  type PermissionResult,
  type PermissionUpdate,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeConfig } from './config.ts'
import { AdapterError, toAdapterError } from './errors.ts'
import {
  detectClaudeInstallation,
  readClaudeAuth,
  readClaudeVersion,
  type ClaudeAuth,
  type ClaudeInstallation,
} from './discover.ts'
import {
  claudeEndpoint,
  discoverOllama,
  isCustomClaudeModel,
  ollamaDefaultModel,
  ollamaModels,
  type ClaudeEndpoint,
  type OllamaCustomRow,
} from './ollama.ts'
import {
  ANTHROPIC_PROVIDER,
  OLLAMA_PROVIDER,
  resolveClaudeProvider,
  type ClaudeProvider,
} from './provider.ts'

export type ClaudeSessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  createdAt?: number
  customTitle?: string
  firstPrompt?: string
  cwd?: string
  gitBranch?: string
  archived?: boolean
  fileSize?: number
}

export type ClaudeSessionMessage = {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  sessionId: string
  message: unknown
  parentToolUseID: string | null
  parentAgentID: string | null
}

export type ClaudeUsage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

export type ClaudeTurnEvent =
  | {
      type: 'init'
      sessionId: string
      model: string
      version: string
      cwd: string
      tools: string[]
      agents: string[]
      commands: string[]
      skills: string[]
      permissionMode: string
      provider: ClaudeProvider
    }
  | {
      type: 'message-start'
      assistantMessageID: string
      model: string
      userMessageID?: string
    }
  | {
      type: 'text-started' | 'text-ended'
      assistantMessageID: string
      ordinal: number
      text?: string
    }
  | {
      type: 'reasoning-started' | 'reasoning-ended'
      assistantMessageID: string
      ordinal: number
      text?: string
    }
  | {
      type: 'text-delta'
      assistantMessageID: string
      ordinal: number
      delta: string
    }
  | {
      type: 'reasoning-delta'
      assistantMessageID: string
      ordinal: number
      delta: string
    }
  | {
      type: 'tool-input-started'
      assistantMessageID: string
      index: number
      toolID: string
      name: string
    }
  | {
      type: 'tool-input-delta'
      assistantMessageID: string
      index: number
      toolID: string
      delta: string
    }
  | {
      type: 'tool-input-ended'
      assistantMessageID: string
      index: number
      toolID: string
      text: string
    }
  | {
      type: 'tool-called'
      assistantMessageID: string
      toolID: string
      input: Record<string, unknown>
    }
  | {
      type: 'assistant'
      assistantMessageID: string
      model: string
      content: ClaudeContentBlock[]
      stopReason?: string
      usage?: ClaudeUsage
      aborted: boolean
      userMessageID?: string
    }
  | {
      type: 'tool-result'
      toolID: string
      content: string
      isError: boolean
    }
  | {
      type: 'result'
      subtype: string
      sessionId: string
      costUsd: number
      usage: ClaudeUsage
      modelUsage: Record<string, ClaudeUsage>
      errors: string[]
      aborted: boolean
      userMessageID?: string
    }
  | {
      type: 'compact'
      trigger: 'manual' | 'auto'
      preTokens: number
    }
  | {
      type: 'error'
      message: string
      fatal: boolean
    }

export type ClaudePermissionRequest = {
  id: string
  toolName: string
  input: Record<string, unknown>
  toolUseID: string
  suggestions?: unknown[]
  title?: string
  description?: string
  agentID?: string
  signal: AbortSignal
}

export type ClaudePermissionDecision =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: unknown[]
    }
  | { behavior: 'deny'; message: string }

export type ClaudeTurnRequest = {
  sessionId: string
  directory: string
  text: string
  files?: string[]
  model?: string
  agent?: string
  synthetic?: boolean
  signal: AbortSignal
  onEvent: (event: ClaudeTurnEvent) => void
  onPermission: (request: ClaudePermissionRequest) => Promise<ClaudePermissionDecision>
  onStderr?: (chunk: string) => void
}

export type ClaudeSteerInput = {
  text: string
  files?: string[]
  priority?: 'now' | 'next' | 'later'
}

export interface ClaudeTurn {
  push(input: ClaudeSteerInput): void
  interrupt(): Promise<void>
  setModel(model?: string): Promise<void>
  /** Stop accepting input and let the CLI exit after its current work. */
  close(): void
}

export type ClaudeModelRow = {
  value: string
  name: string
  description?: string
  resolvedModel?: string
  family?: string
  capabilities?: ClaraModel['capabilities']
  limit?: ClaraModel['limit']
  cost?: ClaraModel['cost']
  status?: ClaraModel['status']
  enabled?: boolean
}

export type ClaudeCatalog = {
  provider: ClaudeProvider
  defaultModel?: string
  models: ClaudeModelRow[]
  agents: { name: string; description?: string; model?: string }[]
  commands: { name: string; description?: string }[]
  skills: string[]
}

export interface ClaudeGateway {
  probe(timeoutMs?: number): Promise<AdapterProbe>
  auth(): Promise<ClaudeAuth | undefined>
  installation(): ClaudeInstallation | undefined
  provider(): ClaudeProvider
  defaultModel(): string | undefined
  listSessions(input: {
    directory?: string
    includeWorktrees?: boolean
  }): Promise<ClaudeSessionInfo[]>
  getSessionInfo(sessionId: string, directory?: string): Promise<ClaudeSessionInfo | undefined>
  getSessionMessages(
    sessionId: string,
    input?: {
      directory?: string
      limit?: number
      offset?: number
      includeSystemMessages?: boolean
    }
  ): Promise<ClaudeSessionMessage[]>
  forkSession(
    sessionId: string,
    input?: { directory?: string; upToMessageId?: string; title?: string }
  ): Promise<string>
  renameSession(sessionId: string, title: string, directory?: string): Promise<void>
  deleteSession(sessionId: string, directory?: string): Promise<void>
  startTurn(request: ClaudeTurnRequest): Promise<ClaudeTurn>
  catalog(directory: string): Promise<ClaudeCatalog>
  lastInit(): ClaudeCatalog | undefined
}

const FALLBACK_MODELS: ClaudeModelRow[] = [
  {
    value: 'default',
    name: 'Claude default',
    description: 'The model configured for this account',
  },
  { value: 'sonnet', name: 'Claude Sonnet', description: 'Balanced speed and capability' },
  { value: 'opus', name: 'Claude Opus', description: 'Highest capability' },
  { value: 'haiku', name: 'Claude Haiku', description: 'Fastest responses' },
]

const PROBE_CACHE_MS = 30_000

class MessageQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiters: ((result: IteratorResult<T>) => void)[] = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
      return: () => {
        this.close()
        return Promise.resolve({ value: undefined as never, done: true })
      },
    }
  }
}

/** The Agent SDK access point. Only this module imports the Claude SDK. */
export class AgentSdkGateway implements ClaudeGateway {
  private readonly config: ClaudeConfig
  private cachedProbe?: { at: number; value: AdapterProbe }
  private cachedAuth?: { at: number; value: ClaudeAuth | undefined }
  private cachedInstallation?: ClaudeInstallation
  private catalogValue?: ClaudeCatalog
  private catalogAt = 0
  private providerValue?: ClaudeProvider
  private defaultModelValue?: string
  private endpointValue?: ClaudeEndpoint

  constructor(config: ClaudeConfig) {
    this.config = config
  }

  private endpoint(): ClaudeEndpoint {
    return (this.endpointValue ??= claudeEndpoint(this.config))
  }

  installation(): ClaudeInstallation | undefined {
    if (!this.cachedInstallation) {
      this.cachedInstallation = detectClaudeInstallation(this.config.claudePath)
    }
    return this.cachedInstallation
  }

  provider(): ClaudeProvider {
    return (
      this.providerValue ??
      resolveClaudeProvider({
        configured: this.config.provider,
        baseUrl: this.endpoint().baseUrl,
      })
    )
  }

  defaultModel(): string | undefined {
    return this.defaultModelValue ?? this.config.model ?? this.endpoint().model
  }

  async probe(timeoutMs = 2_000): Promise<AdapterProbe> {
    const now = Date.now()
    if (this.cachedProbe && now - this.cachedProbe.at < PROBE_CACHE_MS) {
      return this.cachedProbe.value
    }
    const started = Date.now()
    const installation = this.installation()
    if (!installation) {
      return this.cacheProbe({
        ok: false,
        latencyMs: Date.now() - started,
        code: 'unreachable',
        message:
          'Claude Code was not found. Install it on this machine or pass --claude-path to the adapter installer.',
      })
    }

    const version = await readClaudeVersion(installation.binary, timeoutMs)
    if (!version) {
      return this.cacheProbe({
        ok: false,
        latencyMs: Date.now() - started,
        code: 'unreachable',
        message: `Claude Code did not answer at ${installation.binary}`,
      })
    }

    const auth = await this.auth()
    if (auth && !auth.loggedIn) {
      return this.cacheProbe({
        ok: false,
        latencyMs: Date.now() - started,
        code: 'auth',
        version,
        message: 'Claude Code is not signed in on this machine. Run `claude auth login`.',
      })
    }

    return this.cacheProbe({
      ok: true,
      latencyMs: Date.now() - started,
      code: 'ok',
      version,
    })
  }

  async auth(): Promise<ClaudeAuth | undefined> {
    const now = Date.now()
    if (this.cachedAuth && now - this.cachedAuth.at < PROBE_CACHE_MS) return this.cachedAuth.value
    const installation = this.installation()
    const value = installation ? await readClaudeAuth(installation.binary) : undefined
    if (this.providerValue?.id !== OLLAMA_PROVIDER.id) {
      this.providerValue = resolveClaudeProvider({
        configured: this.config.provider,
        ...(value?.apiProvider ? { apiProvider: value.apiProvider } : {}),
        baseUrl: this.endpoint().baseUrl,
      })
    }
    this.cachedAuth = { at: Date.now(), value }
    return value
  }

  async listSessions(input: {
    directory?: string
    includeWorktrees?: boolean
  }): Promise<ClaudeSessionInfo[]> {
    try {
      const sessions = await sdkListSessions({
        ...(input.directory ? { dir: input.directory } : {}),
        includeWorktrees: input.includeWorktrees ?? false,
      })
      return sessions.map(toSessionInfo)
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async getSessionInfo(
    sessionId: string,
    directory?: string
  ): Promise<ClaudeSessionInfo | undefined> {
    try {
      const session = await sdkGetSessionInfo(sessionId, directory ? { dir: directory } : {})
      return session ? toSessionInfo(session) : undefined
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async getSessionMessages(
    sessionId: string,
    input?: {
      directory?: string
      limit?: number
      offset?: number
      includeSystemMessages?: boolean
    }
  ): Promise<ClaudeSessionMessage[]> {
    try {
      const messages = await sdkGetSessionMessages(sessionId, {
        ...(input?.directory ? { dir: input.directory } : {}),
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
        ...(input?.offset !== undefined ? { offset: input.offset } : {}),
        includeSystemMessages: input?.includeSystemMessages ?? true,
      })
      return messages.map(toSessionMessage)
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async forkSession(
    sessionId: string,
    input?: { directory?: string; upToMessageId?: string; title?: string }
  ): Promise<string> {
    try {
      const result = await sdkForkSession(sessionId, {
        ...(input?.directory ? { dir: input.directory } : {}),
        ...(input?.upToMessageId ? { upToMessageId: input.upToMessageId } : {}),
        ...(input?.title ? { title: input.title } : {}),
      })
      return result.sessionId
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async renameSession(sessionId: string, title: string, directory?: string): Promise<void> {
    try {
      await sdkRenameSession(sessionId, title, directory ? { dir: directory } : {})
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async deleteSession(sessionId: string, directory?: string): Promise<void> {
    try {
      await sdkDeleteSession(sessionId, directory ? { dir: directory } : {})
    } catch (cause) {
      throw toAdapterError(cause)
    }
  }

  async startTurn(request: ClaudeTurnRequest): Promise<ClaudeTurn> {
    const installation = this.installation()
    const endpoint = this.endpoint()
    const existing = await this.getSessionInfo(request.sessionId, request.directory).catch(
      () => undefined
    )
    const queue = new MessageQueue<SDKUserMessage>()
    const abort = new AbortController()
    const unlink = linkAbort(request.signal, abort)
    let interrupted = false
    let sawResult = false
    let closed = false

    const options: Parameters<typeof query>[0]['options'] = {
      cwd: request.directory,
      includePartialMessages: true,
      permissionPrompts: this.config.permissionPrompts ?? 'host',
      permissionMode: this.config.permissionMode ?? 'default',
      abortController: abort,
      canUseTool: this.permissionHandler(request),
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'clara-adapter-claude/0.1.0',
        ...(endpoint.baseUrl ? { ANTHROPIC_BASE_URL: endpoint.baseUrl } : {}),
      },
      stderr: (chunk) => request.onStderr?.(chunk),
      ...(existing ? { resume: request.sessionId } : { sessionId: request.sessionId }),
      ...(request.model ? { model: request.model } : {}),
      ...(request.agent ? { agent: request.agent } : {}),
      ...(this.config.maxTurns ? { maxTurns: this.config.maxTurns } : {}),
      ...(this.config.maxBudgetUsd ? { maxBudgetUsd: this.config.maxBudgetUsd } : {}),
      ...(this.config.additionalDirectories
        ? { additionalDirectories: this.config.additionalDirectories }
        : {}),
      ...(this.config.allowDangerouslySkipPermissions ||
      this.config.permissionMode === 'bypassPermissions'
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(installation?.source === 'configured'
        ? { pathToClaudeCodeExecutable: installation.binary }
        : {}),
    }

    const live = query({ prompt: queue, options })
    const finish = () => {
      if (closed) return
      closed = true
      queue.close()
      unlink()
    }

    if (!request.synthetic) queue.push(makeUserMessage(request, 'next'))
    else queue.push(makeUserMessage(request, 'next', true))

    void (async () => {
      try {
        for await (const message of live) {
          if (message.type === 'result') sawResult = true
          this.translate(message, request, () => interrupted)
        }
        if (!sawResult && !request.synthetic && !interrupted) {
          request.onEvent({
            type: 'error',
            message: 'Claude Code ended without a result',
            fatal: true,
          })
        }
      } catch (cause) {
        if (!isAbortError(cause)) {
          request.onEvent({ type: 'error', message: messageOf(cause), fatal: true })
        }
      } finally {
        finish()
      }
    })()

    return {
      push: (input) => {
        if (closed) return
        queue.push(makeUserMessage(input, input.priority ?? 'next'))
      },
      interrupt: async () => {
        interrupted = true
        try {
          await live.interrupt()
        } catch (cause) {
          if (!isAbortError(cause)) throw toAdapterError(cause)
        }
      },
      setModel: async (model) => {
        try {
          await live.setModel(model)
        } catch (cause) {
          throw toAdapterError(cause)
        }
      },
      close: () => finish(),
    }
  }

  async catalog(directory: string): Promise<ClaudeCatalog> {
    if (this.catalogValue && Date.now() - this.catalogAt < 60_000) return this.catalogValue
    return this.readCatalog(directory)
  }

  lastInit(): ClaudeCatalog | undefined {
    return this.catalogValue
  }

  private async readCatalog(directory: string): Promise<ClaudeCatalog> {
    const endpoint = this.endpoint()
    const [ollama, cli] = await Promise.all([
      discoverOllama(endpoint.baseUrl, { authToken: endpoint.authToken }),
      this.readClaudeCatalog(directory, endpoint.baseUrl),
    ])

    const provider = ollama
      ? this.config.provider
        ? resolveClaudeProvider({ configured: this.config.provider })
        : OLLAMA_PROVIDER
      : (cli?.provider ??
        resolveClaudeProvider({
          configured: this.config.provider,
          baseUrl: endpoint.baseUrl,
        }))
    const defaultModel = ollama
      ? ollamaDefaultModel(ollama.models, endpoint.model)
      : (cli?.defaultModel ?? endpoint.model)

    const catalog: ClaudeCatalog = ollama
      ? {
          provider,
          ...(defaultModel ? { defaultModel } : {}),
          models: ollamaModels(
            ollama.models,
            cli?.models.filter(isCustomClaudeModel).map(customRow) ?? []
          ),
          agents: cli?.agents ?? [],
          commands: cli?.commands ?? [],
          skills: cli?.skills ?? [],
        }
      : (cli ?? this.fallbackCatalog(provider, defaultModel))

    this.providerValue = provider
    this.defaultModelValue = defaultModel
    this.catalogValue = catalog
    this.catalogAt = Date.now()
    return catalog
  }

  private async readClaudeCatalog(
    directory: string,
    baseUrl: string | undefined
  ): Promise<ClaudeCatalog | undefined> {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 8_000)
    let deadline: NodeJS.Timeout | undefined
    let live: ReturnType<typeof query> | undefined
    try {
      live = query({
        prompt: (async function* empty() {})(),
        options: {
          cwd: directory,
          permissionPrompts: 'none',
          abortController: abort,
          env: {
            ...process.env,
            ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
          },
          ...(this.installation()?.source === 'configured'
            ? { pathToClaudeCodeExecutable: this.installation()?.binary ?? '' }
            : {}),
        },
      })
      const init = await Promise.race([
        live.initializationResult(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new AdapterError(504, 'timeout', 'Claude Code did not start')),
            8_000
          )
        }),
      ])
      const provider = resolveClaudeProvider({
        configured: this.config.provider,
        ...(init.account?.apiProvider ? { apiProvider: init.account.apiProvider } : {}),
        baseUrl,
      })
      return {
        provider,
        ...(this.config.model ? { defaultModel: this.config.model } : {}),
        models:
          init.models.length > 0
            ? init.models.map(toModelRow)
            : provider.id === ANTHROPIC_PROVIDER.id
              ? FALLBACK_MODELS
              : [],
        agents: init.agents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          ...(agent.model ? { model: agent.model } : {}),
        })),
        commands: init.commands.map((command) => ({
          name: command.name,
          description: command.description,
        })),
        skills: [],
      }
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
      if (deadline) clearTimeout(deadline)
      abort.abort()
      await live?.return(undefined).catch(() => {})
    }
  }

  private fallbackCatalog(provider = this.provider(), model?: string): ClaudeCatalog {
    return {
      provider,
      ...(model ? { defaultModel: model } : {}),
      models: provider.id === ANTHROPIC_PROVIDER.id ? FALLBACK_MODELS : [],
      agents: [],
      commands: [],
      skills: [],
    }
  }

  private permissionHandler(request: ClaudeTurnRequest): CanUseTool {
    return async (toolName, input, options) => {
      if ((this.config.permissionPrompts ?? 'host') === 'none') {
        return {
          behavior: 'deny',
          message: 'Claude Code approvals are disabled on this adapter',
        } satisfies PermissionResult
      }
      const decision = await raceAbort(
        request.onPermission({
          id: randomUUID(),
          toolName,
          input,
          toolUseID: options.toolUseID,
          ...(options.suggestions ? { suggestions: options.suggestions } : {}),
          ...(options.title ? { title: options.title } : {}),
          ...(options.description ? { description: options.description } : {}),
          ...(options.agentID ? { agentID: options.agentID } : {}),
          signal: options.signal,
        }),
        options.signal
      )
      if (decision.behavior === 'deny') {
        return { behavior: 'deny', message: decision.message } satisfies PermissionResult
      }
      return {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? input,
        ...(decision.updatedPermissions && decision.updatedPermissions.length > 0
          ? { updatedPermissions: decision.updatedPermissions as PermissionUpdate[] }
          : {}),
      } satisfies PermissionResult
    }
  }

  private translate(message: SDKMessage, request: ClaudeTurnRequest, interrupted: () => boolean) {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          const provider = this.provider()
          request.onEvent({
            type: 'init',
            sessionId: message.session_id,
            model: message.model,
            version: message.claude_code_version,
            cwd: message.cwd,
            tools: message.tools,
            agents: message.agents ?? [],
            commands: message.slash_commands ?? [],
            skills: message.skills ?? [],
            permissionMode: message.permissionMode,
            provider,
          })
          this.catalogValue = {
            ...(this.catalogValue ?? this.fallbackCatalog(provider)),
            provider,
            agents: (message.agents ?? []).map((name) => ({ name })),
            commands: (message.slash_commands ?? []).map((name) => ({ name })),
            skills: message.skills ?? [],
          }
          return
        }
        if (message.subtype === 'compact_boundary') {
          request.onEvent({
            type: 'compact',
            trigger: message.compact_metadata.trigger,
            preTokens: message.compact_metadata.pre_tokens,
          })
        }
        return

      case 'stream_event':
        this.translateStreamEvent(message, request)
        return

      case 'assistant':
        this.translateAssistant(message, request, interrupted())
        return

      case 'user':
        this.translateToolResults(message, request)
        return

      case 'result':
        this.translateResult(message, request, interrupted())
        return

      default:
        return
    }
  }

  private translateStreamEvent(message: SDKPartialAssistantMessage, request: ClaudeTurnRequest) {
    const event = message.event
    if (event.type === 'message_start') {
      request.onEvent({
        type: 'message-start',
        assistantMessageID: message.uuid,
        model: event.message.model,
        ...(message.user_message_uuid ? { userMessageID: message.user_message_uuid } : {}),
      })
      return
    }
    if (event.type === 'content_block_start') {
      const block = event.content_block
      const state = blocksFor(message)
      if (block.type === 'text') {
        state.set(event.index, { kind: 'text', text: block.text })
        request.onEvent({
          type: 'text-started',
          assistantMessageID: message.uuid,
          ordinal: event.index,
        })
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        state.set(event.index, { kind: 'thinking', text: '' })
        request.onEvent({
          type: 'reasoning-started',
          assistantMessageID: message.uuid,
          ordinal: event.index,
        })
      } else if (block.type === 'tool_use') {
        state.set(event.index, { kind: 'tool', toolID: block.id, name: block.name, input: '' })
        request.onEvent({
          type: 'tool-input-started',
          assistantMessageID: message.uuid,
          index: event.index,
          toolID: block.id,
          name: block.name,
        })
      }
      return
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta
      const block = blocksFor(message).get(event.index)
      if (delta.type === 'text_delta') {
        if (block?.kind === 'text') block.text += delta.text
        request.onEvent({
          type: 'text-delta',
          assistantMessageID: message.uuid,
          ordinal: event.index,
          delta: delta.text,
        })
      } else if (delta.type === 'thinking_delta') {
        if (block?.kind === 'thinking') block.text += delta.thinking
        request.onEvent({
          type: 'reasoning-delta',
          assistantMessageID: message.uuid,
          ordinal: event.index,
          delta: delta.thinking,
        })
      } else if (delta.type === 'input_json_delta' && block?.kind === 'tool') {
        block.input += delta.partial_json
        request.onEvent({
          type: 'tool-input-delta',
          assistantMessageID: message.uuid,
          index: event.index,
          toolID: block.toolID,
          delta: delta.partial_json,
        })
      }
      return
    }
    if (event.type === 'content_block_stop') {
      const block = blocksFor(message).get(event.index)
      if (block?.kind === 'text') {
        request.onEvent({
          type: 'text-ended',
          assistantMessageID: message.uuid,
          ordinal: event.index,
          text: block.text,
        })
      } else if (block?.kind === 'thinking') {
        request.onEvent({
          type: 'reasoning-ended',
          assistantMessageID: message.uuid,
          ordinal: event.index,
          text: block.text,
        })
      } else if (block?.kind === 'tool') {
        request.onEvent({
          type: 'tool-input-ended',
          assistantMessageID: message.uuid,
          index: event.index,
          toolID: block.toolID,
          text: block.input,
        })
      }
      blocksFor(message).delete(event.index)
    }
  }

  private translateAssistant(
    message: SDKAssistantMessage,
    request: ClaudeTurnRequest,
    aborted: boolean
  ) {
    const blocks: ClaudeContentBlock[] = []
    for (const block of message.message.content) {
      if (block.type === 'text') blocks.push({ type: 'text', text: block.text })
      else if (block.type === 'thinking') blocks.push({ type: 'thinking', text: block.thinking })
      else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: recordOf(block.input),
        })
        request.onEvent({
          type: 'tool-called',
          assistantMessageID: message.uuid,
          toolID: block.id,
          input: recordOf(block.input),
        })
      }
    }
    request.onEvent({
      type: 'assistant',
      assistantMessageID: message.uuid,
      model: message.message.model,
      content: blocks,
      ...(message.message.stop_reason ? { stopReason: message.message.stop_reason } : {}),
      usage: usageOf(message.message.usage),
      aborted: message.aborted === true || aborted,
      ...(message.user_message_uuid ? { userMessageID: message.user_message_uuid } : {}),
    })
  }

  private translateToolResults(message: SDKUserMessage, request: ClaudeTurnRequest) {
    if (message.parent_tool_use_id) return
    const content = message.message.content
    if (typeof content === 'string') return
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      request.onEvent({
        type: 'tool-result',
        toolID: block.tool_use_id,
        content: toolResultText(block.content),
        isError: block.is_error === true,
      })
    }
  }

  private translateResult(message: SDKResultMessage, request: ClaudeTurnRequest, aborted: boolean) {
    const usage = usageOf(message.usage)
    const modelUsage: Record<string, ClaudeUsage> = {}
    for (const [model, value] of Object.entries(message.modelUsage)) {
      modelUsage[model] = {
        input: value.inputTokens,
        output: value.outputTokens,
        reasoning: value.thinkingTokens ?? 0,
        cacheRead: value.cacheReadInputTokens ?? 0,
        cacheWrite: value.cacheCreationInputTokens ?? 0,
      }
    }
    request.onEvent({
      type: 'result',
      subtype: message.subtype,
      sessionId: message.session_id,
      costUsd: message.total_cost_usd ?? 0,
      usage,
      modelUsage,
      errors: 'errors' in message ? message.errors : [],
      aborted: aborted || message.subtype === 'error_during_execution',
      ...(message.user_message_uuid ? { userMessageID: message.user_message_uuid } : {}),
    })
  }

  private cacheProbe(value: AdapterProbe): AdapterProbe {
    this.cachedProbe = { at: Date.now(), value }
    return value
  }
}

type StreamBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; toolID: string; name: string; input: string }

const streamBlocks = new WeakMap<SDKPartialAssistantMessage, Map<number, StreamBlock>>()

function blocksFor(message: SDKPartialAssistantMessage): Map<number, StreamBlock> {
  const existing = streamBlocks.get(message)
  if (existing) return existing
  const created = new Map<number, StreamBlock>()
  streamBlocks.set(message, created)
  return created
}

function makeUserMessage(
  request: { text: string; files?: string[]; sessionId?: string },
  priority: 'now' | 'next' | 'later',
  synthetic = false
): SDKUserMessage {
  const text = [request.text, ...(request.files ?? []).map(fileMention)]
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    priority,
    ...(synthetic ? { isSynthetic: true, shouldQuery: false } : {}),
    uuid: randomUUID(),
  }
}

function fileMention(uri: string): string {
  try {
    const url = new URL(uri)
    if (url.protocol === 'file:') return `@${decodeURIComponent(url.pathname)}`
    return `@${uri}`
  } catch {
    return `@${uri}`
  }
}

function toSessionInfo(session: {
  sessionId: string
  summary: string
  lastModified: number
  createdAt?: number
  customTitle?: string
  firstPrompt?: string
  cwd?: string
  gitBranch?: string
  archived?: boolean
  fileSize?: number
}): ClaudeSessionInfo {
  return {
    sessionId: session.sessionId,
    summary: session.summary,
    lastModified: session.lastModified,
    ...(session.createdAt !== undefined ? { createdAt: session.createdAt } : {}),
    ...(session.customTitle ? { customTitle: session.customTitle } : {}),
    ...(session.firstPrompt ? { firstPrompt: session.firstPrompt } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
    ...(session.archived !== undefined ? { archived: session.archived } : {}),
    ...(session.fileSize !== undefined ? { fileSize: session.fileSize } : {}),
  }
}

function toSessionMessage(message: SessionMessage): ClaudeSessionMessage {
  return {
    type: message.type,
    uuid: message.uuid,
    sessionId: message.session_id,
    message: message.message,
    parentToolUseID: message.parent_tool_use_id,
    parentAgentID: message.parent_agent_id,
  }
}

function toModelRow(model: ModelInfo): ClaudeModelRow {
  return {
    value: model.value,
    name: model.displayName,
    description: model.description,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
  }
}

function customRow(model: ClaudeModelRow): OllamaCustomRow {
  return {
    value: model.value,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
  }
}

function usageOf(value: unknown): ClaudeUsage {
  const usage = recordOf(value)
  return {
    input: numberValue(usage?.input_tokens),
    output: numberValue(usage?.output_tokens),
    reasoning: numberValue(usage?.thinking_tokens),
    cacheRead: numberValue(usage?.cache_read_input_tokens),
    cacheWrite: numberValue(usage?.cache_creation_input_tokens),
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function linkAbort(source: AbortSignal, target: AbortController): () => void {
  if (source.aborted) {
    target.abort()
    return () => {}
  }
  const abort = () => target.abort()
  source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AdapterError(499, 'aborted', 'The permission request was aborted')
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new AdapterError(499, 'aborted', 'The permission request was aborted')),
        { once: true }
      )
    }),
  ])
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
