import { randomBytes, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type {
  ClaraEvent,
  ClaraHarnessProject,
  ClaraModelRef,
  ClaraSession,
  ClaraSessionMessage,
  ClaraSessionsResponse,
  ClaraTokenUsage,
} from '@clara/api-contract'
import { AdapterError } from '@clara/adapter-runtime'
import { sessionDirFor, sessionRoots, type PiConfig } from './config.ts'
import type { PiSessionSummary, ParsedSession } from './pi/format.ts'
import { parseSession, sessionSummary } from './pi/format.ts'
import { SessionIndex } from './pi/indexer.ts'
import { mapTranscript, type PromptIdentity } from './pi/transcript.ts'
import type { PromptMap } from './prompt-map.ts'

const MAX_PAGE = 100
const PROJECT_CACHE_MS = 5_000
const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const AGENT = 'pi'

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
  archived?: boolean
  metadata?: Record<string, unknown>
}

export type PiSessionTarget = {
  sessionID: string
  path: string
  cwd: string
  name?: string
  existing: boolean
}

export class SessionService {
  private readonly config: PiConfig
  private readonly index: SessionIndex
  private readonly prompts: PromptMap
  private readonly version: string
  private readonly publish: (event: ClaraEvent) => void
  private projectCache?: { at: number; value: ClaraHarnessProject[] }
  closeSession?: (sessionID: string) => Promise<void>
  renameSession?: (sessionID: string, title: string) => Promise<boolean>

  constructor(
    config: PiConfig,
    index: SessionIndex,
    prompts: PromptMap,
    version: string,
    publish: (event: ClaraEvent) => void
  ) {
    this.config = config
    this.index = index
    this.prompts = prompts
    this.version = version
    this.publish = publish
  }

  async list(input: SessionListInput): Promise<ClaraSessionsResponse> {
    const requested = input.project ?? input.directory
    const directory = requested ? canonical(requested) : undefined
    let summaries = await this.index.list(sessionRoots(this.config, directory))
    if (directory) {
      summaries = summaries.filter((summary) => canonical(summary.cwd) === directory)
    }
    if (input.parentID) {
      const parent = await this.index.resolve(input.parentID)
      summaries = parent ? summaries.filter((summary) => summary.parentSession === parent.path) : []
    }
    if (input.search?.trim()) {
      const search = input.search.trim().toLowerCase()
      summaries = summaries.filter(
        (summary) =>
          (summary.name ?? '').toLowerCase().includes(search) ||
          summary.firstMessage.toLowerCase().includes(search)
      )
    }
    summaries.sort((a, b) => b.updated - a.updated)
    if (input.order === 'asc') summaries.reverse()

    const limit = pageLimit(input.limit)
    const offset = cursorOffset(input.cursor)
    const page = summaries.slice(offset, offset + limit)
    const data = await Promise.all(page.map((summary) => this.toClaraSession(summary)))
    return {
      data,
      cursor: {
        previous: null,
        next: offset + limit < summaries.length ? `offset:${offset + limit}` : null,
      },
    }
  }

  async get(sessionID: string, directory?: string): Promise<ClaraSession> {
    const resolved = await this.require(sessionID, directory)
    return this.toClaraSession(resolved.summary)
  }

  async messages(
    sessionID: string,
    input: MessageListInput
  ): Promise<{ data: ClaraSessionMessage[]; cursor: { previous: null; next: string | null } }> {
    const resolved = await this.require(sessionID)
    const session = await this.index.read(resolved.path)
    let messages = mapTranscript({
      session,
      providerID: resolved.summary.model?.providerID ?? 'pi',
      agent: AGENT,
      prompts: this.prompts.identities(sessionID),
    })
    if (input.type) messages = messages.filter((message) => message.type === input.type)

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

  async create(input: CreateSessionInput): Promise<ClaraSession> {
    const requested = input.location?.directory
    if (!requested) {
      throw new AdapterError(400, 'invalid_request', 'A session directory is required')
    }
    const directory = requireDirectory(requested)
    const id = input.id && SESSION_ID.test(input.id) ? input.id : randomUUID()
    const existing = await this.index.resolve(id)
    if (existing) {
      throw new AdapterError(409, 'SessionExistsError', `Session ${id} already exists`)
    }
    const target = sessionPath(this.config, directory, id)
    mkdirSync(target.directory, { recursive: true, mode: 0o700 })
    const now = new Date()
    const header = {
      type: 'session' as const,
      version: 3,
      id,
      timestamp: now.toISOString(),
      cwd: directory,
    }
    const lines = [JSON.stringify(header)]
    let parent: string | null = null
    if (input.title?.trim()) {
      const info = sessionInfoEntry(input.title.trim(), null, now)
      parent = info.id
      lines.push(JSON.stringify(info))
    }
    const model = modelRef(input.model)
    if (model) {
      lines.push(
        JSON.stringify({
          type: 'model_change',
          id: entryID(),
          parentId: parent,
          timestamp: now.toISOString(),
          provider: model.providerID,
          modelId: model.id,
        })
      )
    }
    writeFileSync(target.path, `${lines.join('\n')}\n`, { mode: 0o600 })
    const session = parseSession(`${lines.join('\n')}\n`)
    const summary = sessionSummary(target.path, session)
    this.projectCache = undefined
    this.publish({
      id: `session-created-${id}`,
      type: 'session.created',
      created: now.getTime(),
      data: {
        sessionID: id,
        projectID: directory,
        location: { directory },
        slug: id,
        version: this.version,
        ...(summary.name ? { title: summary.name } : {}),
        ...(summary.model ? { model: summary.model } : {}),
      },
    })
    return this.toClaraSession(summary)
  }

  async update(sessionID: string, input: UpdateSessionInput): Promise<void> {
    const resolved = await this.require(sessionID)
    if (typeof input.title !== 'string') return
    const title = input.title.trim()
    const renamed = this.renameSession
      ? await this.renameSession(sessionID, title).catch(() => false)
      : false
    if (!renamed) {
      appendEntry(
        resolved.path,
        sessionInfoEntry(title, resolved.summary.lastEntryId ?? null, new Date())
      )
    }
    this.index.forget(resolved.path)
    this.publish({
      id: `session-renamed-${sessionID}-${Date.now()}`,
      type: 'session.renamed',
      created: Date.now(),
      data: { sessionID, title },
    })
  }

  async remove(sessionID: string): Promise<void> {
    const resolved = await this.require(sessionID)
    await this.closeSession?.(sessionID)
    if (existsSync(resolved.path)) unlinkSync(resolved.path)
    this.index.forget(resolved.path)
    this.prompts.forget(sessionID)
    this.projectCache = undefined
    this.publish({
      id: `session-deleted-${sessionID}-${Date.now()}`,
      type: 'session.deleted',
      created: Date.now(),
      data: { sessionID },
    })
  }

  async target(sessionID: string): Promise<PiSessionTarget> {
    const resolved = await this.require(sessionID)
    return {
      sessionID,
      path: resolved.path,
      cwd: resolved.summary.cwd,
      existing: true,
      ...(resolved.summary.name ? { name: resolved.summary.name } : {}),
    }
  }

  async read(
    sessionID: string
  ): Promise<{ path: string; summary: PiSessionSummary; session: ParsedSession }> {
    const resolved = await this.require(sessionID)
    return { ...resolved, session: await this.index.read(resolved.path) }
  }

  /** Read a session file that may live outside the currently indexed roots. */
  async fromPath(path: string): Promise<ClaraSession> {
    const session = await this.index.read(path)
    return this.toClaraSession(sessionSummary(path, session))
  }

  rememberPrompt(sessionID: string, identity: PromptIdentity, timestamp: number): void {
    this.prompts.remember(sessionID, identity, timestamp)
  }

  identities(sessionID: string): Map<number, PromptIdentity> {
    return this.prompts.identities(sessionID)
  }

  forget(sessionID: string): void {
    this.prompts.forget(sessionID)
  }

  invalidateProjects(): void {
    this.projectCache = undefined
  }

  async projects(archived: boolean): Promise<ClaraHarnessProject[]> {
    if (archived) return []
    const now = Date.now()
    if (this.projectCache && now - this.projectCache.at < PROJECT_CACHE_MS) {
      return this.projectCache.value
    }
    const groups = new Map<string, { created: number; updated: number }>()
    for (const summary of await this.index.list()) {
      const directory = canonical(summary.cwd)
      const current = groups.get(directory)
      groups.set(directory, {
        created: Math.min(current?.created ?? summary.created, summary.created),
        updated: Math.max(current?.updated ?? summary.updated, summary.updated),
      })
    }
    const value = [...groups.entries()].map(([directory, times]) => ({
      id: directory,
      canonical: directory,
      name: basename(directory),
      time: { created: times.created, updated: times.updated, active: times.updated },
      ...(existsSync(join(directory, '.git')) ? { vcs: 'git' } : {}),
      sandboxes: [],
    }))
    this.projectCache = { at: now, value }
    return value
  }

  private async require(
    sessionID: string,
    directory?: string
  ): Promise<{ path: string; summary: PiSessionSummary }> {
    const resolved = await this.index.resolve(
      sessionID,
      directory ? sessionRoots(this.config, directory) : []
    )
    if (!resolved) {
      throw new AdapterError(404, 'SessionNotFoundError', `Session ${sessionID} was not found`)
    }
    return resolved
  }

  private async toClaraSession(summary: PiSessionSummary): Promise<ClaraSession> {
    const directory = summary.cwd
    const parent = summary.parentSession
      ? await this.index.summary(summary.parentSession).catch(() => undefined)
      : undefined
    const title = summary.name ?? summary.firstMessage
    return {
      id: summary.id,
      projectID: canonical(directory),
      cost: summary.cost,
      tokens: summary.tokens as ClaraTokenUsage,
      time: { created: summary.created, updated: summary.updated },
      ...(parent ? { parentID: parent.id } : {}),
      ...(title ? { title } : {}),
      ...(summary.model ? { model: summary.model } : {}),
      location: { directory },
    }
  }
}

function sessionInfoEntry(name: string, parentId: string | null, time: Date) {
  return {
    type: 'session_info',
    id: entryID(),
    parentId,
    timestamp: time.toISOString(),
    name,
  }
}

function appendEntry(path: string, entry: Record<string, unknown>): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

function entryID(): string {
  return randomBytes(4).toString('hex')
}

function sessionPath(
  config: PiConfig,
  cwd: string,
  id: string
): { directory: string; path: string } {
  const directory = sessionDirFor(config, cwd)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return { directory, path: join(directory, `${timestamp}_${id}.jsonl`) }
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
