import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { realpathSync } from 'node:fs'
import type {
  ClaraEvent,
  ClaraHarnessProject,
  ClaraModelRef,
  ClaraSession,
  ClaraSessionMessage,
  ClaraSessionsResponse,
} from '@clara/api-contract'
import { AdapterError } from './errors.ts'
import type { ClaudeGateway, ClaudeSessionInfo, ClaudeSessionMessage } from './sdk.ts'
import { SessionStore, emptyTokens, type StoredSession } from './store.ts'
import {
  claudeProjectsDirectory,
  findTranscript,
  mapTranscript,
  readTranscript,
  transcriptUsage,
  type TranscriptEntry,
} from './transcript.ts'

const MAX_PAGE = 100
const PROJECT_CACHE_MS = 5_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SessionListInput = {
  project?: string
  directory?: string
  search?: string
  limit?: number
  order?: 'asc' | 'desc'
  cursor?: string
  parentID?: string
  archived?: boolean
  subpath?: string
}

export type MessageListInput = {
  order?: 'asc' | 'desc'
  limit?: number
  cursor?: string
  type?: string
}

export type CreateSessionInput = {
  id?: string
  parentID?: string
  title?: string
  agent?: string
  model?: unknown
  location?: { directory?: string }
  metadata?: Record<string, unknown>
  permissions?: unknown
}

export type UpdateSessionInput = {
  title?: string
  metadata?: Record<string, unknown>
  permissions?: unknown
  archived?: boolean
}

export class SessionService {
  private projectCache?: { at: number; value: ClaraHarnessProject[] }
  private readonly claude: ClaudeGateway
  private readonly store: SessionStore
  private readonly version: string
  private readonly publish: (event: ClaraEvent) => void

  constructor(
    claude: ClaudeGateway,
    store: SessionStore,
    version: string,
    publish: (event: ClaraEvent) => void
  ) {
    this.claude = claude
    this.store = store
    this.version = version
    this.publish = publish
  }

  async list(input: SessionListInput): Promise<ClaraSessionsResponse> {
    if (input.parentID) return { data: [], cursor: { previous: null, next: null } }

    const directory = input.project
      ? canonical(input.project)
      : input.directory
        ? canonical(input.directory)
        : undefined

    const [remote, stored] = await Promise.all([
      directory
        ? this.claude
            .listSessions({ directory, includeWorktrees: false })
            .catch(() => [] as ClaudeSessionInfo[])
        : this.claude.listSessions({}).catch(() => [] as ClaudeSessionInfo[]),
      Promise.resolve(directory ? this.store.byDirectory(directory) : this.store.list()),
    ])

    const byID = new Map<string, { info?: ClaudeSessionInfo; stored?: StoredSession }>()
    for (const info of remote) byID.set(info.sessionId, { info })
    for (const session of stored) {
      const current = byID.get(session.id) ?? {}
      byID.set(session.id, { ...current, stored: session })
    }

    let sessions = [...byID.values()].map(({ info, stored }) => toClaraSession(info, stored))
    if (directory) {
      sessions = sessions.filter(
        (session) =>
          canonical(session.location.directory) === directory || session.projectID === directory
      )
    }
    if (input.search?.trim()) {
      const search = input.search.trim().toLowerCase()
      sessions = sessions.filter((session) => (session.title ?? '').toLowerCase().includes(search))
    }

    sessions.sort((a, b) => b.time.updated - a.time.updated)
    if (input.order === 'asc') sessions.reverse()

    const limit = pageLimit(input.limit)
    const offset = cursorOffset(input.cursor)
    const page = sessions.slice(offset, offset + limit)
    const next = offset + limit < sessions.length ? `offset:${offset + limit}` : null
    return { data: page, cursor: { previous: null, next } }
  }

  async get(sessionId: string, directory?: string): Promise<ClaraSession> {
    const record = await this.lookup(sessionId, directory)
    if (!record) throw notFound(sessionId)
    const usage = await this.transcriptUsage(record.info, record.stored)
    return toClaraSession(record.info, record.stored, usage)
  }

  async create(input: CreateSessionInput): Promise<ClaraSession> {
    const requested = input.location?.directory
    if (!requested)
      throw new AdapterError(400, 'invalid_request', 'A session directory is required')
    const canonicalDirectory = requireDirectory(requested)
    const now = Date.now()
    const id = input.id && UUID.test(input.id) ? input.id : randomUUID()
    const model = modelRef(input.model)
    const session: StoredSession = {
      id,
      directory: canonicalDirectory,
      canonical: canonicalDirectory,
      ...(input.title ? { title: input.title } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      ...(model ? { model } : {}),
      createdAt: now,
      updatedAt: now,
      cost: 0,
      tokens: emptyTokens(),
      started: false,
    }
    this.store.put(session)
    this.invalidateProjects()
    this.publish({
      id: `session-created-${id}`,
      type: 'session.created',
      created: now,
      data: {
        sessionID: id,
        projectID: canonicalDirectory,
        location: { directory: canonicalDirectory },
        slug: id,
        version: this.version,
        ...(session.title ? { title: session.title } : {}),
        ...(session.agent ? { agent: session.agent } : {}),
        ...(session.model ? { model: session.model } : {}),
      },
    })
    return toClaraSession(undefined, session)
  }

  async update(sessionId: string, input: UpdateSessionInput): Promise<void> {
    const record = await this.lookup(sessionId)
    if (!record) throw notFound(sessionId)
    const directory = record.stored?.directory ?? record.info?.cwd
    const patch: Partial<StoredSession> = { updatedAt: Date.now() }
    if (typeof input.title === 'string') {
      patch.title = input.title
      if (record.info) {
        await this.claude.renameSession(sessionId, input.title, directory).catch(() => {})
      }
    }
    if (typeof input.archived === 'boolean') patch.archived = input.archived
    const stored =
      this.store.get(sessionId) ?? this.storeFromInfo(sessionId, record.info, directory)
    if (stored) this.store.put({ ...stored, ...patch })
    if (typeof input.title === 'string') {
      this.publish({
        id: `session-renamed-${sessionId}-${Date.now()}`,
        type: 'session.renamed',
        created: Date.now(),
        data: { sessionID: sessionId, title: input.title },
      })
    }
    if (typeof input.archived === 'boolean') {
      this.publish({
        id: `session-archive-${sessionId}-${Date.now()}`,
        type: input.archived ? 'session.archived' : 'session.unarchived',
        created: Date.now(),
        data: { sessionID: sessionId },
      })
    }
  }

  async remove(sessionId: string): Promise<void> {
    const stored = this.store.get(sessionId)
    try {
      await this.claude.deleteSession(sessionId, stored?.directory)
    } catch (cause) {
      if (stored?.directory) {
        await this.claude.deleteSession(sessionId).catch(() => {})
      } else {
        throw cause
      }
    }
    this.store.delete(sessionId)
    this.invalidateProjects()
    this.publish({
      id: `session-deleted-${sessionId}-${Date.now()}`,
      type: 'session.deleted',
      created: Date.now(),
      data: { sessionID: sessionId },
    })
  }

  async fork(sessionId: string, before?: string): Promise<ClaraSession> {
    const record = await this.lookup(sessionId)
    if (!record) throw notFound(sessionId)
    const directory = record.stored?.directory ?? record.info?.cwd
    const messages = await this.messages(sessionId, { limit: MAX_PAGE * 4 })
    const boundary = before ? forkBoundary(messages.data, before) : undefined
    const forkedId = await this.claude.forkSession(sessionId, {
      ...(directory ? { directory } : {}),
      ...(boundary ? { upToMessageId: boundary } : {}),
      ...(record.stored?.title ? { title: `${record.stored.title} (fork)` } : {}),
    })
    const now = Date.now()
    const stored: StoredSession = {
      id: forkedId,
      directory: directory ?? '',
      canonical: record.stored?.canonical ?? (directory ? canonical(directory) : ''),
      createdAt: now,
      updatedAt: now,
      cost: 0,
      tokens: emptyTokens(),
      started: true,
      forkedFrom: sessionId,
      ...(record.stored?.title ? { title: `${record.stored.title} (fork)` } : {}),
      ...(record.stored?.agent ? { agent: record.stored.agent } : {}),
      ...(record.stored?.model ? { model: record.stored.model } : {}),
    }
    this.store.put(stored)
    this.invalidateProjects()
    this.publish({
      id: `session-forked-${forkedId}`,
      type: 'session.forked',
      created: now,
      data: {
        sessionID: forkedId,
        parentID: sessionId,
        boundary: { type: 'before', messageID: before ?? '' },
      },
    })
    return toClaraSession(undefined, stored)
  }

  async move(sessionId: string, requestedDirectory: string): Promise<void> {
    const record = await this.lookup(sessionId)
    if (!record) throw notFound(sessionId)
    const canonicalDirectory = requireDirectory(requestedDirectory)
    const stored =
      this.store.get(sessionId) ??
      this.storeFromInfo(sessionId, record.info, record.stored?.directory ?? record.info?.cwd)
    if (!stored) throw notFound(sessionId)
    this.store.put({
      ...stored,
      directory: canonicalDirectory,
      canonical: canonicalDirectory,
      updatedAt: Date.now(),
    })
    this.invalidateProjects()
    this.publish({
      id: `session-moved-${sessionId}-${Date.now()}`,
      type: 'session.moved',
      created: Date.now(),
      data: {
        sessionID: sessionId,
        location: { directory: canonicalDirectory },
        projectID: canonicalDirectory,
      },
    })
  }

  async messages(
    sessionId: string,
    input: MessageListInput
  ): Promise<{ data: ClaraSessionMessage[]; cursor: { previous: null; next: string | null } }> {
    const record = await this.lookup(sessionId)
    if (!record) throw notFound(sessionId)
    if (record.stored?.started === false && !record.info) {
      return { data: [], cursor: { previous: null, next: null } }
    }
    const directory = record.stored?.directory ?? record.info?.cwd ?? ''
    const start = record.info?.createdAt ?? record.info?.lastModified ?? Date.now()
    const entries = await this.transcriptEntries(sessionId, directory)
    const messages = mapTranscript(entries, start)
    const limit = pageLimit(input.limit)
    const offset = cursorOffset(input.cursor)

    if (input.order === 'asc') {
      const page = messages.slice(offset, offset + limit)
      return {
        data: page,
        cursor: {
          previous: null,
          next: offset + limit < messages.length ? `offset:${offset + limit}` : null,
        },
      }
    }

    const end = Math.max(0, messages.length - offset)
    const from = Math.max(0, end - limit)
    return {
      data: messages.slice(from, end).reverse(),
      cursor: { previous: null, next: from > 0 ? `offset:${offset + limit}` : null },
    }
  }

  setSelection(
    sessionId: string,
    input: { directory: string; model?: ClaraModelRef; agent?: string }
  ): void {
    const existing = this.store.get(sessionId) ?? {
      id: sessionId,
      directory: input.directory,
      canonical: canonical(input.directory),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cost: 0,
      tokens: emptyTokens(),
      started: false,
    }
    this.store.put({
      ...existing,
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      updatedAt: Date.now(),
    })
  }

  recordTurn(
    sessionId: string,
    input: {
      directory: string
      costUsd: number
      tokens: ReturnType<typeof emptyTokens>
      outcome: 'succeeded' | 'failed' | 'interrupted'
      started: boolean
      model?: string
      agent?: string
      error?: string
    }
  ): { cost: number; tokens: ReturnType<typeof emptyTokens> } {
    const existing = this.store.get(sessionId) ?? {
      id: sessionId,
      directory: input.directory,
      canonical: canonical(input.directory),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cost: 0,
      tokens: emptyTokens(),
      started: false,
    }
    const tokens = maxTokens(existing.tokens, input.tokens)
    const cost = Math.max(existing.cost, input.costUsd)
    this.store.put({
      ...existing,
      cost,
      tokens,
      started: existing.started || input.started,
      outcome: input.outcome,
      updatedAt: Date.now(),
      ...(input.model ? { model: { id: input.model, providerID: 'anthropic' } } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.error ? { lastError: input.error } : {}),
    })
    this.invalidateProjects()
    return { cost, tokens }
  }

  async projects(archived: boolean): Promise<ClaraHarnessProject[]> {
    if (archived) return []
    const now = Date.now()
    if (this.projectCache && now - this.projectCache.at < PROJECT_CACHE_MS) {
      return this.projectCache.value
    }

    const groups = new Map<string, { created: number; updated: number }>()
    const add = (directory: string | undefined, created: number, updated: number) => {
      if (!directory) return
      const canonicalDirectory = canonical(directory)
      const current = groups.get(canonicalDirectory)
      groups.set(canonicalDirectory, {
        created: Math.min(current?.created ?? created, created),
        updated: Math.max(current?.updated ?? updated, updated),
      })
    }

    for (const stored of this.store.list()) {
      add(stored.canonical || stored.directory, stored.createdAt, stored.updatedAt)
    }
    const remote = await this.claude.listSessions({}).catch(() => [] as ClaudeSessionInfo[])
    for (const info of remote) {
      add(info.cwd, info.createdAt ?? info.lastModified, info.lastModified)
    }

    const value = [...groups.entries()].map(([directory, times]) => ({
      id: directory,
      canonical: directory,
      name: basename(directory),
      time: { created: times.created, updated: times.updated, active: times.updated },
      ...(existsSync(`${directory}/.git`) ? { vcs: 'git' } : {}),
      sandboxes: [],
    }))
    this.projectCache = { at: now, value }
    return value
  }

  invalidateProjects(): void {
    this.projectCache = undefined
  }

  private async lookup(
    sessionId: string,
    directory?: string
  ): Promise<{ info?: ClaudeSessionInfo; stored?: StoredSession } | undefined> {
    const stored = this.store.get(sessionId)
    let info: ClaudeSessionInfo | undefined
    if (!stored || stored.started) {
      info = await this.claude
        .getSessionInfo(sessionId, directory ?? stored?.directory)
        .catch(() => undefined)
      if (!info && (directory || stored?.directory)) {
        info = await this.claude.getSessionInfo(sessionId).catch(() => undefined)
      }
    }
    if (!info && !stored) return undefined
    return { ...(info ? { info } : {}), ...(stored ? { stored } : {}) }
  }

  private async transcriptEntries(
    sessionId: string,
    directory: string
  ): Promise<TranscriptEntry[]> {
    const auth = await this.claude.auth()
    const projectsDirectory = claudeProjectsDirectory(auth?.projectsDirectory)
    const path = findTranscript(projectsDirectory, directory, sessionId)
    if (path) return readTranscript(path)

    const messages = await this.claude
      .getSessionMessages(sessionId, { includeSystemMessages: true })
      .catch(() => [] as ClaudeSessionMessage[])
    return messages.map(toTranscriptEntry)
  }

  private async transcriptUsage(
    info: ClaudeSessionInfo | undefined,
    stored: StoredSession | undefined
  ): Promise<{ cost: number; tokens: ReturnType<typeof emptyTokens>; model?: string } | undefined> {
    if (!info && !stored) return undefined
    if (stored && stored.cost > 0) return { cost: stored.cost, tokens: stored.tokens }
    const directory = stored?.directory ?? info?.cwd
    if (!directory) return undefined
    const auth = await this.claude.auth()
    const projectsDirectory = claudeProjectsDirectory(auth?.projectsDirectory)
    const path = findTranscript(projectsDirectory, directory, stored?.id ?? info?.sessionId ?? '')
    if (!path) return undefined
    return transcriptUsage(readTranscript(path))
  }

  private storeFromInfo(
    sessionId: string,
    info: ClaudeSessionInfo | undefined,
    directory: string | undefined
  ): StoredSession | undefined {
    if (!info || !directory) return undefined
    return {
      id: sessionId,
      directory,
      canonical: canonical(directory),
      createdAt: info.createdAt ?? info.lastModified,
      updatedAt: info.lastModified,
      cost: 0,
      tokens: emptyTokens(),
      started: true,
      ...((info.customTitle ?? info.summary) ? { title: info.customTitle ?? info.summary } : {}),
    }
  }
}

function toClaraSession(
  info: ClaudeSessionInfo | undefined,
  stored: StoredSession | undefined,
  usage?: { cost: number; tokens: ReturnType<typeof emptyTokens>; model?: string }
): ClaraSession {
  const directory = stored?.directory ?? info?.cwd ?? ''
  const canonicalDirectory = stored?.canonical ?? (directory ? canonical(directory) : '')
  const created = stored?.createdAt ?? info?.createdAt ?? info?.lastModified ?? Date.now()
  const updated = Math.max(stored?.updatedAt ?? 0, info?.lastModified ?? 0, created)
  const title = stored?.title ?? info?.customTitle ?? info?.summary
  const model =
    stored?.model ?? (usage?.model ? { id: usage.model, providerID: 'anthropic' } : undefined)
  const archived = stored?.archived === true || info?.archived === true

  return {
    id: stored?.id ?? info?.sessionId ?? '',
    projectID: canonicalDirectory,
    cost: usage?.cost ?? stored?.cost ?? 0,
    tokens: usage?.tokens ?? stored?.tokens ?? emptyTokens(),
    ...(stored?.outcome ? { outcome: stored.outcome } : {}),
    time: {
      created,
      updated,
      ...(archived ? { archived: updated } : {}),
    },
    ...(title ? { title } : {}),
    ...(stored?.agent ? { agent: stored.agent } : {}),
    ...(model ? { model } : {}),
    location: { directory },
  }
}

function toTranscriptEntry(message: ClaudeSessionMessage): TranscriptEntry {
  return {
    type: message.type,
    uuid: message.uuid,
    message: message.message,
  }
}

function modelRef(value: unknown): ClaraModelRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.providerID !== 'string') return undefined
  return {
    id: record.id,
    providerID: record.providerID,
    ...(typeof record.variant === 'string' ? { variant: record.variant } : {}),
  }
}

function forkBoundary(messages: ClaraSessionMessage[], before: string): string | undefined {
  const index = messages.findIndex((message) => message.id === before)
  if (index <= 0) return undefined
  return messages[index - 1]?.id
}

function canonical(directory: string): string {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}

function requireDirectory(directory: string): string {
  try {
    return realpathSync(directory)
  } catch {
    throw new AdapterError(
      404,
      'LocationNotFoundError',
      `The directory ${directory} does not exist on the harness machine`,
      { directory }
    )
  }
}

function pageLimit(value: number | undefined): number {
  if (value === undefined) return MAX_PAGE
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE)
}

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0
  const value = cursor.startsWith('offset:')
    ? Number(cursor.slice('offset:'.length))
    : Number(cursor)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function maxTokens(
  current: ReturnType<typeof emptyTokens>,
  next: ReturnType<typeof emptyTokens>
): ReturnType<typeof emptyTokens> {
  return {
    input: Math.max(current.input, next.input),
    output: Math.max(current.output, next.output),
    reasoning: Math.max(current.reasoning, next.reasoning),
    cache: {
      read: Math.max(current.cache.read, next.cache.read),
      write: Math.max(current.cache.write, next.cache.write),
    },
  }
}

function notFound(sessionId: string): AdapterError {
  return new AdapterError(404, 'SessionNotFoundError', `Session ${sessionId} was not found`)
}
