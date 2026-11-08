import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createClaraServer } from '@clara/mcp-server'
import type { Runtime } from '@clara/orchestration'
import { instanceMode } from '@clara/orchestration-control'
import { RuntimeBackend } from './backend.ts'

export interface OrchestratorServerOptions {
  runtime: Runtime
  token: string
  host?: string
  port?: number
  tickMs?: number
  workspace?: string
  stdDir?: string
  configPath?: string
}

export interface OrchestratorServer {
  server: Server
  close(): Promise<void>
}

class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new HttpError(413, 'body_too_large', 'request body is too large')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new HttpError(400, 'invalid_json', (error as Error).message)
  }
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function runID(url: URL): number {
  const value = Number(url.pathname.split('/')[3])
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, 'bad_run', 'invalid run id')
  return value
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function createOrchestratorServer(options: OrchestratorServerOptions): OrchestratorServer {
  const { runtime, token } = options
  const backend = new RuntimeBackend(runtime)
  const mcpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; close: () => void }
  >()

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, {
          ok: true,
          service: 'clara-orchestrator',
          version: '0.1.0',
          mode: instanceMode(),
          pid: process.pid,
        })
        return
      }
      if (bearer(req) !== token) {
        json(res, 401, { error: { code: 'unauthorized', message: 'missing or invalid token' } })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/config') {
        json(res, 200, {
          workspace: options.workspace ?? null,
          ...(options.stdDir ? { stdDir: options.stdDir } : {}),
          ...(options.configPath ? { configPath: options.configPath } : {}),
        })
        return
      }
      if (url.pathname === '/mcp') {
        await handleMcp(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        streamEvents(req, res, runtime, Number(url.searchParams.get('since') ?? 0))
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/catalog') {
        const workspace = url.searchParams.get('workspace')
        if (!workspace)
          throw new HttpError(400, 'workspace_required', 'workspace query is required')
        json(res, 200, await backend.catalog(workspace))
        return
      }
      if (url.pathname === '/v1/runs' && req.method === 'GET') {
        json(res, 200, await backend.list())
        return
      }
      if (url.pathname === '/v1/runs' && req.method === 'POST') {
        const input = await body(req)
        json(res, 201, await backend.start(input as never))
        return
      }
      if (url.pathname === '/v1/inbox' && req.method === 'GET') {
        json(res, 200, await backend.inbox())
        return
      }
      if (url.pathname === '/v1/tick' && req.method === 'POST') {
        json(res, 200, await backend.tick())
        return
      }
      const alertMatch = url.pathname.match(/^\/v1\/alerts\/(\d+)\/ack$/)
      if (alertMatch && req.method === 'POST') {
        json(res, 200, await backend.ack(Number(alertMatch[1])))
        return
      }
      if (url.pathname === '/v1/adapters' && req.method === 'GET') {
        json(res, 200, await backend.adapters(url.searchParams.get('workspace') ?? undefined))
        return
      }
      if (url.pathname === '/v1/adapters/register' && req.method === 'POST') {
        json(res, 200, await backend.registerAdapter((await body(req)) as never))
        return
      }
      const adapterHeartbeat = url.pathname.match(/^\/v1\/adapters\/([^/]+)\/heartbeat$/)
      if (adapterHeartbeat && req.method === 'POST') {
        json(res, 200, await backend.heartbeatAdapter(decode(adapterHeartbeat[1])))
        return
      }
      const adapterDelete = url.pathname.match(/^\/v1\/adapters\/([^/]+)$/)
      if (adapterDelete && req.method === 'DELETE') {
        json(res, 200, await backend.removeAdapter(decode(adapterDelete[1])))
        return
      }
      if (url.pathname.match(/^\/v1\/runs\/\d+$/) && req.method === 'GET') {
        json(res, 200, await backend.status(runID(url)))
        return
      }
      const snapshotMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/snapshot$/)
      if (snapshotMatch && req.method === 'GET') {
        json(res, 200, await backend.pinned(Number(snapshotMatch[1])))
        return
      }
      const runAttemptsMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/attempts$/)
      if (runAttemptsMatch && req.method === 'GET') {
        json(res, 200, await backend.attempts(Number(runAttemptsMatch[1])))
        return
      }
      const stepAttemptsMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/steps\/(.+)\/attempts$/)
      if (stepAttemptsMatch && req.method === 'GET') {
        json(
          res,
          200,
          await backend.attempts(Number(stepAttemptsMatch[1]), decode(stepAttemptsMatch[2]))
        )
        return
      }
      const stepDetailMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/steps\/(.+)$/)
      if (stepDetailMatch && req.method === 'GET') {
        json(res, 200, await backend.step(Number(stepDetailMatch[1]), decode(stepDetailMatch[2])))
        return
      }
      if (url.pathname.match(/^\/v1\/runs\/\d+\/next$/) && req.method === 'POST') {
        const input = await body(req)
        json(res, 200, await backend.next(runID(url), number(input.limit, 1)))
        return
      }
      if (url.pathname.match(/^\/v1\/runs\/\d+\/cancel$/) && req.method === 'POST') {
        const input = await body(req)
        json(
          res,
          200,
          await backend.cancel(
            runID(url),
            typeof input.reason === 'string' ? input.reason : 'human'
          )
        )
        return
      }
      const stepMatch = url.pathname.match(
        /^\/v1\/runs\/(\d+)\/steps\/(.+)\/(complete|fail|route|check|usage|heartbeat|spawn|violation)$/
      )
      if (stepMatch && req.method === 'POST') {
        const rid = Number(stepMatch[1])
        const path = decode(stepMatch[2])
        const action = stepMatch[3]
        const input = await body(req)
        const value = { ...input, run_id: rid, step_path: path }
        if (action === 'complete') json(res, 200, await backend.complete(value as never))
        else if (action === 'fail') json(res, 200, await backend.fail(value as never))
        else if (action === 'route') json(res, 200, await backend.route(value as never))
        else if (action === 'check') json(res, 200, await backend.check(value as never))
        else if (action === 'usage') json(res, 200, await backend.usage(value as never))
        else if (action === 'heartbeat')
          json(res, 200, await backend.heartbeat(rid, path, String(input.work_token ?? '')))
        else if (action === 'violation')
          json(res, 200, runtime.violation(rid, path, String(input.reason ?? 'policy violation')))
        else json(res, 200, await backend.spawn(value as never))
        return
      }
      json(res, 404, { error: { code: 'not_found', message: `${req.method} ${url.pathname}` } })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 422
      const code =
        error instanceof HttpError
          ? error.code
          : typeof (error as { code?: unknown }).code === 'string'
            ? String((error as { code: string }).code)
            : 'orchestration_error'
      const message = error instanceof Error ? error.message : String(error)
      json(res, status, { error: { code, message } })
    }
  })

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionID = req.headers['mcp-session-id']
    if (typeof sessionID === 'string' && mcpSessions.has(sessionID)) {
      await mcpSessions.get(sessionID)?.transport.handleRequest(req, res)
      return
    }
    if (req.method !== 'POST') {
      json(res, 404, { error: { code: 'mcp_session', message: 'unknown MCP session' } })
      return
    }
    const parsed = await body(req)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        mcpSessions.set(id, { transport, close: () => void transport.close() })
      },
      onsessionclosed: (id) => {
        mcpSessions.delete(id)
      },
    })
    const mcp = createClaraServer(backend)
    const notificationState = { last: 0 }
    const timer = setInterval(() => {
      void notifyAlerts(mcp, runtime, notificationState)
    }, 2_000)
    timer.unref?.()
    transport.onclose = () => {
      clearInterval(timer)
      if (transport.sessionId) mcpSessions.delete(transport.sessionId)
    }
    await mcp.connect(transport)
    await transport.handleRequest(req, res, parsed)
  }

  const tickMs = options.tickMs ?? 10_000
  const tick = setInterval(() => {
    try {
      runtime.tick()
    } catch (error) {
      console.error('[orchestrator] watchdog tick failed', error)
    }
  }, tickMs)
  tick.unref?.()

  return {
    server,
    async close() {
      clearInterval(tick)
      for (const entry of mcpSessions.values()) entry.close()
      mcpSessions.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function notifyAlerts(
  mcp: ReturnType<typeof createClaraServer>,
  runtime: Runtime,
  state: { last: number }
): Promise<void> {
  const alerts = runtime.inbox().filter((alert) => Number(alert.id) > state.last)
  if (!alerts.length) return
  state.last = Math.max(...alerts.map((alert) => Number(alert.id)))
  await mcp.server.sendResourceUpdated({ uri: 'clara://inbox' }).catch(() => {})
  for (const alert of alerts) {
    await mcp.server
      .sendLoggingMessage({
        level: alert.kind === 'stalled' ? 'warning' : 'error',
        logger: 'clara',
        data: {
          alert: Number(alert.id),
          run_id: Number(alert.run_id),
          step: alert.step_path,
          kind: alert.kind,
          title: alert.title,
          body: alert.body,
        },
      })
      .catch(() => {})
  }
}

function eventData(event: {
  id: number | bigint
  payload: string
  run_id: number | bigint | string
  created_at: string
}): string {
  try {
    const payload = JSON.parse(event.payload) as Record<string, unknown>
    return JSON.stringify({
      ...payload,
      run_id: Number(event.run_id),
      event_id: Number(event.id),
      created_at: event.created_at,
    })
  } catch {
    return JSON.stringify({
      run_id: Number(event.run_id),
      event_id: Number(event.id),
      created_at: event.created_at,
      payload: event.payload,
    })
  }
}

function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: Runtime,
  since: number
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  res.write('retry: 1000\n\n')
  let cursor = Number.isFinite(since) ? since : 0
  let lastComment = Date.now()
  const poll = setInterval(() => {
    const events = runtime.store.allEvents(cursor, 200)
    for (const event of events) {
      cursor = Number(event.id)
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${eventData(event)}\n\n`)
    }
    if (Date.now() - lastComment > 15_000) {
      res.write(': heartbeat\n\n')
      lastComment = Date.now()
    }
  }, 1_000)
  poll.unref?.()
  const close = () => {
    clearInterval(poll)
    res.end()
  }
  req.on('close', close)
  res.on('close', close)
}
