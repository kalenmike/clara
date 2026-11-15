import {
  claraPermissionRequestListOutputSchema,
  claraSessionActiveOutputSchema,
  claraSessionSchema,
  claraSessionsResponseSchema,
  type ClaraSession,
  type ClaraSessionActiveOutput,
} from '@clara/api-contract'
import type { z } from 'zod'
import type {
  PanelSession,
  PanelSessionHarness,
  PanelSessionState,
  PanelSessionsQuery,
  PanelSessionsResponse,
} from '@clara/shared-types'
import { HarnessOfflineError, type HarnessConnection } from '../harness/types.ts'
import type { HarnessManager } from '../harness/manager.ts'
import { query } from '../api/harness.ts'

const HARNESS_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 8_000
const LIST_PAGE_SIZE = 100
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const MAX_ACTIVE_LOOKUPS = 25
const WORKERS = 4

type SessionMonitorOptions = {
  harness: HarnessManager
  canAccess: () => boolean
  log?: (message: string, detail?: unknown) => void
}

type HarnessRows = {
  status: PanelSessionHarness
  rows: PanelSession[]
  truncated: boolean
}

type ActiveLookup = {
  sessions: ClaraSession[]
  truncated: boolean
}

/**
 * Read every paired harness for the panel's read-only Sessions view. The hub
 * normally scopes a request to one harness; this fan-out is the deliberate
 * exception, so a host can find runaway or forgotten work across all of them.
 */
export class SessionMonitor {
  private readonly options: SessionMonitorOptions

  constructor(options: SessionMonitorOptions) {
    this.options = options
  }

  async load(
    request: PanelSessionsQuery = {},
    signal: AbortSignal = new AbortController().signal
  ): Promise<PanelSessionsResponse> {
    const limit = clampLimit(request.limit)
    const connections = this.options.harness
      .list()
      .filter((connection) => !request.harnessID || connection.harnessId === request.harnessID)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.harnessId.localeCompare(right.harnessId)
      )

    if (!this.options.canAccess()) {
      return {
        generatedAt: new Date().toISOString(),
        sessions: [],
        harnesses: connections.map((connection) => disabledStatus(connection)),
        truncated: false,
      }
    }

    const results = await Promise.all(
      connections.map((connection) =>
        this.loadHarness(connection, withTimeout(signal, HARNESS_TIMEOUT_MS), limit, request)
      )
    )

    const sessions = results
      .flatMap((result) => result.rows)
      .sort(compareSessions)
      .slice(0, limit * Math.max(1, connections.length))

    return {
      generatedAt: new Date().toISOString(),
      sessions,
      harnesses: results.map((result) => result.status),
      truncated: results.some((result) => result.truncated),
    }
  }

  private async loadHarness(
    connection: HarnessConnection,
    signal: AbortSignal,
    limit: number,
    request: PanelSessionsQuery
  ): Promise<HarnessRows> {
    const base = baseStatus(connection)

    if (!connection.online) {
      return {
        rows: [],
        truncated: false,
        status: {
          ...base,
          ok: false,
          code: 'offline',
          message: 'The harness adapter is offline',
        },
      }
    }

    const [listed, active, permissions] = await Promise.allSettled([
      this.listSessions(connection, signal, limit),
      this.activeSessions(connection, signal),
      this.permissionSessions(connection, signal),
    ])

    if (listed.status === 'rejected') {
      return {
        rows: [],
        truncated: false,
        status: {
          ...base,
          ok: false,
          ...errorStatus(listed.reason),
        },
      }
    }

    const activeIDs =
      active.status === 'fulfilled'
        ? new Set(
            Object.entries(active.value)
              .filter(([, state]) => state.type === 'running')
              .map(([sessionID]) => sessionID)
          )
        : new Set<string>()
    const awaiting = permissions.status === 'fulfilled' ? permissions.value : new Set<string>()

    const details = new Map<string, ClaraSession>()
    for (const session of listed.value.sessions) details.set(session.id, session)
    const lookup = await this.lookupActive(connection, signal, activeIDs, details)
    for (const session of lookup.sessions) details.set(session.id, session)

    const rows: PanelSession[] = []
    for (const session of details.values()) {
      const overlaid = this.options.harness.overlaySession(connection.harnessId, session)
      if (!request.includeArchived && overlaid.time.archived != null) continue
      if (request.runningOnly && !activeIDs.has(overlaid.id)) continue
      if (request.search && !matches(overlaid, request.search)) continue
      rows.push(toRow(connection, overlaid, activeIDs, awaiting))
    }

    const activeFailed = active.status === 'rejected'
    return {
      rows,
      truncated: listed.value.truncated || lookup.truncated,
      status: {
        ...base,
        ok: !activeFailed,
        ...(activeFailed ? { code: 'partial', message: 'The active session lookup failed' } : {}),
        sessionCount: rows.length,
        runningCount: rows.filter((row) => row.state === 'running').length,
      },
    }
  }

  private async listSessions(
    connection: HarnessConnection,
    signal: AbortSignal,
    limit: number
  ): Promise<ActiveLookup> {
    const sessions: ClaraSession[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    let truncated = false

    while (sessions.length < limit) {
      const page = await this.request(
        connection,
        {
          method: 'GET',
          path: '/sessions',
          search: query({
            archived: false,
            order: 'desc',
            limit: Math.min(LIST_PAGE_SIZE, limit - sessions.length),
            ...(cursor ? { cursor } : {}),
          }),
        },
        signal,
        (value) => parse(claraSessionsResponseSchema, value, 'session list')
      )

      for (const session of page.data) {
        if (seen.has(session.id)) continue
        seen.add(session.id)
        sessions.push(session)
        if (sessions.length >= limit) break
      }

      const next = page.cursor.next ?? undefined
      if (next && next !== cursor && page.data.length > 0 && sessions.length < limit) {
        cursor = next
        continue
      }
      truncated = Boolean(next && next !== cursor)
      break
    }

    return { sessions, truncated }
  }

  private async activeSessions(
    connection: HarnessConnection,
    signal: AbortSignal
  ): Promise<ClaraSessionActiveOutput> {
    return this.request(
      connection,
      { method: 'GET', path: '/sessions/active' },
      signal,
      (value) => parse(claraSessionActiveOutputSchema, value, 'active session map'),
      true
    )
  }

  private async permissionSessions(
    connection: HarnessConnection,
    signal: AbortSignal
  ): Promise<Set<string>> {
    const result = await this.request(
      connection,
      { method: 'GET', path: '/permissions' },
      signal,
      (value) => parse(claraPermissionRequestListOutputSchema, value, 'permission requests')
    )
    return new Set(result.data.map((request) => request.sessionID))
  }

  private async lookupActive(
    connection: HarnessConnection,
    signal: AbortSignal,
    activeIDs: ReadonlySet<string>,
    details: ReadonlyMap<string, ClaraSession>
  ): Promise<ActiveLookup> {
    const missing = [...activeIDs].filter((sessionID) => !details.has(sessionID))
    const truncated = missing.length > MAX_ACTIVE_LOOKUPS
    const selected = missing.slice(0, MAX_ACTIVE_LOOKUPS)
    const sessions = await mapLimit(selected, WORKERS, async (sessionID) => {
      try {
        return await this.request(
          connection,
          { method: 'GET', path: `/sessions/${encodeURIComponent(sessionID)}` },
          signal,
          (value) => parse(claraSessionSchema, value, 'session'),
          true
        )
      } catch {
        // A session can disappear between the active lookup and this request.
        return undefined
      }
    })
    return {
      sessions: sessions.filter((session): session is ClaraSession => session !== undefined),
      truncated,
    }
  }

  private async request<T>(
    connection: HarnessConnection,
    input: { method: 'GET'; path: string; search?: string },
    signal: AbortSignal,
    parseValue: (value: unknown) => T,
    unwrapData = false
  ): Promise<T> {
    const response = await this.options.harness.requestFor(
      connection.harnessId,
      input,
      AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text.trim() || `The harness responded with ${response.status}`)
    }
    const value = (await response.json()) as unknown
    const parsed = unwrapData && isRecord(value) && 'data' in value ? value.data : value
    return parseValue(parsed)
  }
}

function toRow(
  connection: HarnessConnection,
  session: ClaraSession,
  activeIDs: ReadonlySet<string>,
  awaiting: ReadonlySet<string>
): PanelSession {
  const state: PanelSessionState = awaiting.has(session.id)
    ? 'awaiting-input'
    : activeIDs.has(session.id)
      ? 'running'
      : 'idle'
  return {
    id: session.id,
    harnessID: connection.harnessId,
    harnessLabel: connection.label,
    harnessKind: connection.kind,
    ...(session.title ? { title: session.title } : {}),
    ...(session.agent ? { agent: session.agent } : {}),
    ...(session.model ? { model: modelLabel(session) } : {}),
    directory: session.location.directory,
    ...(session.projectID ? { projectID: session.projectID } : {}),
    ...(session.parentID ? { parentID: session.parentID } : {}),
    state,
    archived: session.time.archived != null,
    snoozed: session.metadata?.snoozed === true,
    createdAt: new Date(session.time.created).toISOString(),
    updatedAt: new Date(session.time.updated).toISOString(),
  }
}

function baseStatus(connection: HarnessConnection): PanelSessionHarness {
  return {
    harnessID: connection.harnessId,
    label: connection.label,
    kind: connection.kind,
    online: connection.online,
    ok: true,
    sessionCount: 0,
    runningCount: 0,
  }
}

function disabledStatus(connection: HarnessConnection): PanelSessionHarness {
  return {
    ...baseStatus(connection),
    ok: false,
    code: 'disabled',
    message: 'Harness access is disabled by an admin setting',
  }
}

function compareSessions(left: PanelSession, right: PanelSession): number {
  const rank = (session: PanelSession) =>
    session.state === 'running' ? 0 : session.state === 'awaiting-input' ? 1 : 2
  return (
    rank(left) - rank(right) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.harnessID.localeCompare(right.harnessID) ||
    left.id.localeCompare(right.id)
  )
}

function matches(session: ClaraSession, search: string): boolean {
  const text = search.trim().toLowerCase()
  if (!text) return true
  return [session.title, session.agent, session.id, session.location.directory, modelLabel(session)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(text)
}

function modelLabel(session: ClaraSession): string | undefined {
  return session.model ? `${session.model.providerID}/${session.model.id}` : undefined
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)))
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`The harness returned an invalid ${label}`)
  return result.data
}

function errorStatus(cause: unknown): { code: string; message: string } {
  if (cause instanceof HarnessOfflineError) {
    return { code: 'offline', message: cause.message }
  }
  return {
    code: cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'upstream_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
