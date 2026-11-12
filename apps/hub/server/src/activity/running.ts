import {
  findPlanTodos,
  type ClaraActivityHarness,
  type ClaraPlanTodo,
  type ClaraRunningSession,
  type ClaraRunningSessionsResponse,
  type ClaraSession,
} from '@clara/api-contract'
import { ApiRequestError, type ApiDependencies } from '../api/context.ts'
import {
  forwardDtoTo,
  parseClaraSession,
  parseClaraSessionActive,
  parseClaraSessionMessages,
} from '../api/dto.ts'
import type { HarnessConnection } from '../harness/types.ts'

const HARNESS_TIMEOUT_MS = 5_000
const TODO_CACHE_MS = 5_000

type TodoCacheEntry = {
  at: number
  todos?: ClaraPlanTodo[]
  unavailable?: boolean
}

type HarnessResult = {
  status: ClaraActivityHarness
  data: ClaraRunningSession[]
}

/**
 * Read running sessions from every paired harness. The hub API is normally
 * scoped to the active harness; this service is the deliberate exception for
 * the read-only activity view.
 */
export class RunningActivityService {
  private readonly deps: ApiDependencies
  private readonly todoCache = new Map<string, TodoCacheEntry>()

  constructor(deps: ApiDependencies) {
    this.deps = deps
  }

  async load(
    signal: AbortSignal,
    options: { refresh?: boolean } = {}
  ): Promise<ClaraRunningSessionsResponse> {
    if (!this.deps.canAccess()) {
      throw new ApiRequestError(403, 'disabled', 'Harness access is disabled by an admin setting')
    }

    const results = await Promise.all(
      this.deps.harness
        .list()
        .map((connection) =>
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
    options: { refresh?: boolean } = {}
  ): Promise<HarnessResult> {
    const status: ClaraActivityHarness = {
      harnessID: connection.harnessId,
      kind: connection.kind,
      label: connection.label,
      online: connection.online,
      active: connection.isActive,
      ok: true,
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

    let runningIDs: string[]
    try {
      const active = await forwardDtoTo(
        this.deps,
        connection.harnessId,
        { method: 'GET', path: '/sessions/active' },
        signal,
        parseClaraSessionActive,
        true
      )
      runningIDs = Object.entries(active)
        .filter(([, state]) => state.type === 'running')
        .map(([sessionID]) => sessionID)
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

    const settled = await Promise.allSettled(
      runningIDs.map((sessionID) => this.loadSession(connection, sessionID, signal, options))
    )
    const data: ClaraRunningSession[] = []
    const failures: string[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') data.push(result.value)
      else failures.push(errorMessage(result.reason))
    }
    data.sort((left, right) => right.session.time.updated - left.session.time.updated)

    return {
      data,
      status:
        failures.length === 0
          ? status
          : {
              ...status,
              ok: false,
              code: 'partial',
              message: `${failures.length} running ${
                failures.length === 1 ? 'session' : 'sessions'
              } could not be loaded`,
            },
    }
  }

  private async loadSession(
    connection: HarnessConnection,
    sessionID: string,
    signal: AbortSignal,
    options: { refresh?: boolean } = {}
  ): Promise<ClaraRunningSession> {
    const session = await forwardDtoTo(
      this.deps,
      connection.harnessId,
      {
        method: 'GET',
        path: `/sessions/${encodeURIComponent(sessionID)}`,
      },
      signal,
      parseClaraSession,
      true
    )
    const overlaid = this.deps.harness.overlaySession(connection.harnessId, session)
    return {
      harnessID: connection.harnessId,
      session: overlaid,
      ...(await this.loadTodos(connection, overlaid, signal, options)),
    }
  }

  private async loadTodos(
    connection: HarnessConnection,
    session: ClaraSession,
    signal: AbortSignal,
    options: { refresh?: boolean } = {}
  ): Promise<Pick<ClaraRunningSession, 'todos' | 'todosUnavailable'>> {
    const key = `${connection.harnessId}:${session.id}`
    const cached = options.refresh ? undefined : this.todoCache.get(key)
    if (cached && Date.now() - cached.at < TODO_CACHE_MS) {
      return {
        ...(cached.todos ? { todos: cached.todos } : {}),
        ...(cached.unavailable ? { todosUnavailable: true } : {}),
      }
    }

    try {
      const messages = await forwardDtoTo(
        this.deps,
        connection.harnessId,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(session.id)}/context`,
        },
        signal,
        parseClaraSessionMessages,
        true
      )
      const todos = findPlanTodos(messages, {
        ...(session.fork ? { forkedAt: session.time.created } : {}),
      })
      this.todoCache.set(key, { at: Date.now(), ...(todos ? { todos } : {}) })
      return todos ? { todos } : {}
    } catch {
      this.todoCache.set(key, { at: Date.now(), unavailable: true })
      return { todosUnavailable: true }
    }
  }
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
