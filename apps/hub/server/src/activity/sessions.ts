import {
  findPlanTodos,
  type ClaraActivityHarness,
  type ClaraActivitySession,
  type ClaraActivitySessionsResponse,
  type ClaraPermissionRequest,
  type ClaraPlanTodo,
  type ClaraSession,
  type ClaraSessionActiveOutput,
} from '@clara/api-contract'
import { resolveSessionMailbox, type SessionMailboxSignals } from '@clara/shared-types'
import { ApiRequestError, type ApiDependencies } from '../api/context.ts'
import {
  forwardDtoTo,
  parseClaraPermissionRequests,
  parseClaraSessions,
  parseClaraSessionActive,
  parseClaraSessionMessagesResponse,
} from '../api/dto.ts'
import { query } from '../api/harness.ts'
import type { HarnessConnection } from '../harness/types.ts'
import type { SessionSignalsService } from './session-signals.ts'

const HARNESS_TIMEOUT_MS = 30_000
const SESSION_PAGE_LIMIT = 100
const MAX_SESSIONS_PER_HARNESS = 1_000
const SESSION_WORKERS = 4
const TODO_CACHE_MS = 5_000
const IDLE_TODO_CACHE_MS = 5 * 60_000
const PLAN_PAGE_SIZE = 50
const PLAN_BUDGET_PER_HARNESS = 50

type TodoCacheEntry = {
  at: number
  updated: number
  todos?: ClaraPlanTodo[]
  unavailable?: boolean
}

type HarnessResult = {
  status: ClaraActivityHarness
  data: ClaraActivitySession[]
}

type ActivityOptions = {
  refresh?: boolean
  runningOnly?: boolean
  /** Restrict the fan-out and results to one Clara project. */
  projectID?: string
}

/**
 * Read Inbox and Outbox sessions from paired harnesses. The hub API is normally
 * scoped to every paired harness; this service is the deliberate exception for
 * the read-only activity view. Callers can scope the fan-out to one project,
 * across every workspace and harness that project uses.
 */
export class ActivitySessionsService {
  private readonly deps: ApiDependencies
  private readonly signals: SessionSignalsService
  private readonly todoCache = new Map<string, TodoCacheEntry>()

  constructor(deps: ApiDependencies, signals: SessionSignalsService) {
    this.deps = deps
    this.signals = signals
  }

  async load(
    signal: AbortSignal,
    options: ActivityOptions = {}
  ): Promise<ClaraActivitySessionsResponse> {
    if (!this.deps.canAccess()) {
      throw new ApiRequestError(403, 'disabled', 'Harness access is disabled by an admin setting')
    }

    let connections = [...this.deps.harness.list()].sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.harnessId.localeCompare(right.harnessId)
    )
    if (options.projectID) {
      const project = this.deps.harness.projects.get(options.projectID)
      if (!project) {
        throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      }
      const projectHarnessIDs = new Set(project.workspaces.map((workspace) => workspace.harnessID))
      connections = connections.filter((connection) => projectHarnessIDs.has(connection.harnessId))
    }

    const results = await Promise.all(
      connections.map((connection) =>
        this.loadHarness(connection, withTimeout(signal, HARNESS_TIMEOUT_MS), options)
      )
    )

    return {
      data: results.flatMap((result) => result.data),
      harnesses: results.map((result) => result.status),
    }
  }

  private async loadHarness(
    connection: HarnessConnection,
    signal: AbortSignal,
    options: ActivityOptions = {}
  ): Promise<HarnessResult> {
    const status: ClaraActivityHarness = {
      harnessID: connection.harnessId,
      kind: connection.kind,
      label: connection.label,
      online: connection.online,
      ok: true,
      createdAt: connection.createdAt,
    }

    if (!connection.online) {
      return {
        data: [],
        status: {
          ...status,
          ok: false,
          code: 'offline',
          message: 'The harness adapter is offline',
        },
      }
    }

    let active: ClaraSessionActiveOutput
    let permissions: ClaraPermissionRequest[]
    let sessions: ClaraSession[]
    try {
      const permissionsRequest = forwardDtoTo(
        this.deps,
        connection.harnessId,
        { method: 'GET', path: '/permissions' },
        signal,
        parseClaraPermissionRequests
      ).then(
        (result) => result.data,
        () => []
      )
      const sessionsRequest = this.listSessions(connection, signal)
      ;[active, permissions, sessions] = await Promise.all([
        forwardDtoTo(
          this.deps,
          connection.harnessId,
          { method: 'GET', path: '/sessions/active' },
          signal,
          parseClaraSessionActive,
          true
        ),
        permissionsRequest,
        sessionsRequest,
      ])
    } catch (cause) {
      return {
        data: [],
        status: {
          ...status,
          ok: false,
          ...errorStatus(cause),
        },
      }
    }

    const running = new Set(
      Object.entries(active)
        .filter(([, state]) => state.type === 'running')
        .map(([sessionID]) => sessionID)
    )
    const awaitingInput = new Set(permissions.map((request) => request.sessionID))
    const visible = sessions
      .map((session) => this.deps.harness.overlaySession(connection.harnessId, session))
      .filter((session) => session.time.archived == null && session.metadata?.snoozed !== true)
    if (!options.runningOnly) this.pruneCaches(connection.harnessId, visible)
    const scoped = options.projectID
      ? visible.filter((session) => session.projectID === options.projectID)
      : visible
    const candidates = scoped.filter((session) => !options.runningOnly || running.has(session.id))

    let failures = 0
    let firstFailure: unknown
    const items = await mapLimit(candidates, SESSION_WORKERS, async (session) => {
      const isRunning = running.has(session.id)
      let signals: SessionMailboxSignals | undefined
      try {
        signals = await this.loadSignals(connection, session, options)
      } catch (cause) {
        failures += 1
        if (firstFailure === undefined) firstFailure = cause
      }
      const mailbox = resolveSessionMailbox(signals, {
        running: isRunning,
        awaitingInput: awaitingInput.has(session.id),
      })
      if (mailbox === 'draft') return null

      return {
        harnessID: connection.harnessId,
        session,
        mailbox,
      } satisfies Pick<ClaraActivitySession, 'harnessID' | 'session' | 'mailbox'>
    })

    const classified = items.filter(
      (item): item is Pick<ClaraActivitySession, 'harnessID' | 'session' | 'mailbox'> =>
        item !== null
    )
    // Plans are the expensive part of the fan-out. Load them for Outbox first,
    // then for the most recently updated Inbox sessions, and leave the rest
    // marked as skipped so large histories stay responsive.
    const planOrder = [...classified].sort(
      (left, right) =>
        Number(right.mailbox === 'outbox') - Number(left.mailbox === 'outbox') ||
        right.session.time.updated - left.session.time.updated
    )
    const planIDs = new Set(
      planOrder.slice(0, PLAN_BUDGET_PER_HARNESS).map((item) => item.session.id)
    )
    const data = await mapLimit(classified, SESSION_WORKERS, async (item) => {
      if (!planIDs.has(item.session.id)) return { ...item, todosSkipped: true }
      return {
        ...item,
        ...(await this.loadTodos(
          connection,
          item.session,
          running.has(item.session.id),
          signal,
          options
        )),
      }
    })
    data.sort(compareActivitySessions)
    if (firstFailure !== undefined) {
      this.deps.log(
        `${failures} activity ${failures === 1 ? 'session' : 'sessions'} could not be classified`,
        firstFailure
      )
    }

    return {
      data,
      status:
        failures === 0
          ? status
          : {
              ...status,
              ok: false,
              code: 'partial',
              message: `${failures} ${failures === 1 ? 'session' : 'sessions'} could not be classified`,
            },
    }
  }

  private pruneCaches(harnessID: string, sessions: readonly ClaraSession[]): void {
    const prefix = `${harnessID}:`
    const seen = new Set(sessions.map((session) => `${prefix}${session.id}`))
    this.signals.prune(
      harnessID,
      sessions.map((session) => session.id)
    )
    for (const key of this.todoCache.keys()) {
      if (key.startsWith(prefix) && !seen.has(key)) this.todoCache.delete(key)
    }
  }

  private async listSessions(
    connection: HarnessConnection,
    signal: AbortSignal
  ): Promise<ClaraSession[]> {
    const sessions: ClaraSession[] = []
    const seen = new Set<string>()
    let cursor: string | undefined

    while (sessions.length < MAX_SESSIONS_PER_HARNESS) {
      const page = await forwardDtoTo(
        this.deps,
        connection.harnessId,
        {
          method: 'GET',
          path: '/sessions',
          search: query({
            archived: false,
            order: 'desc',
            limit: SESSION_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          }),
        },
        signal,
        parseClaraSessions
      )

      for (const session of page.data) {
        if (seen.has(session.id)) continue
        seen.add(session.id)
        sessions.push(session)
        if (sessions.length >= MAX_SESSIONS_PER_HARNESS) break
      }

      const next = page.cursor.next ?? undefined
      if (!next || next === cursor || page.data.length === 0) break
      cursor = next
    }

    return sessions
  }

  private loadSignals(
    connection: HarnessConnection,
    session: ClaraSession,
    options: { refresh?: boolean }
  ): Promise<SessionMailboxSignals> {
    return this.signals.forSession(connection.harnessId, session.id, session.time.updated, options)
  }

  private async loadTodos(
    connection: HarnessConnection,
    session: ClaraSession,
    running: boolean,
    signal: AbortSignal,
    options: { refresh?: boolean }
  ): Promise<Pick<ClaraActivitySession, 'todos' | 'todosUnavailable'>> {
    const key = `${connection.harnessId}:${session.id}`
    const cached = options.refresh ? undefined : this.todoCache.get(key)
    const ttl = running ? TODO_CACHE_MS : IDLE_TODO_CACHE_MS
    if (cached && cached.updated === session.time.updated && Date.now() - cached.at < ttl) {
      return {
        ...(cached.todos ? { todos: cached.todos } : {}),
        ...(cached.unavailable ? { todosUnavailable: true } : {}),
      }
    }

    try {
      const page = await forwardDtoTo(
        this.deps,
        connection.harnessId,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(session.id)}/messages`,
          search: query({ order: 'desc', limit: PLAN_PAGE_SIZE, type: 'assistant' }),
        },
        signal,
        parseClaraSessionMessagesResponse
      )
      // The page is newest first; findPlanTodos scans from the end.
      const todos = findPlanTodos([...page.data].reverse(), {
        ...(session.fork ? { forkedAt: session.time.created } : {}),
      })
      this.todoCache.set(key, {
        at: Date.now(),
        updated: session.time.updated,
        ...(todos ? { todos } : {}),
      })
      return todos ? { todos } : {}
    } catch {
      this.todoCache.set(key, {
        at: Date.now(),
        updated: session.time.updated,
        unavailable: true,
      })
      return { todosUnavailable: true }
    }
  }
}

function compareActivitySessions(left: ClaraActivitySession, right: ClaraActivitySession): number {
  return (
    left.session.time.created - right.session.time.created ||
    left.session.id.localeCompare(right.session.id)
  )
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return AbortSignal.any([signal, timeout])
}

function errorStatus(cause: unknown): { code: string; message: string } {
  if (cause instanceof ApiRequestError) {
    return { code: cause.code, message: cause.message }
  }
  return {
    code: cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'upstream_error',
    message: errorMessage(cause),
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
