import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createClaraServer } from '@clara/mcp'
import type { Runtime } from '@clara/orchestration'
import { bundledStdDir, defaultConfigPath } from '@clara/orchestration/loader'
import { instanceMode } from '@clara/service-control'
import { RuntimeBackend } from './backend.ts'

export interface EngineServerOptions {
  runtime: Runtime
  token: string
  host?: string
  port?: number
  tickMs?: number
  workspace?: string
  configPath?: string
}

export interface EngineServer {
  server: Server
  close(): Promise<void>
}

/**
 * The engine ships its standard packages and default routing config beside the
 * module. These are the only two roots the assets endpoint may read.
 */
export interface EngineAssetRoots {
  stdDir?: string
  defaultDir?: string
}

export interface EngineAssetBundle {
  version: string
  hash: string
  files: Record<string, string>
}

const ENGINE_VERSION = '0.1.0'
const MAX_ASSET_FILE_BYTES = 512 * 1024
const MAX_ASSET_BUNDLE_BYTES = 4_000_000
const TEXT_ASSET_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.yml',
  '.yaml',
  '.json',
  '.txt',
  '.toml',
  '.sh',
  '.py',
  '.ts',
  '.js',
])

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

function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {}
): void {
  const body = JSON.stringify(value, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
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

/** Resolve the two roots the loader exposes for the engine's bundled assets. */
function engineAssetRoots(): EngineAssetRoots {
  const stdDir = bundledStdDir()
  const config = defaultConfigPath()
  const roots: EngineAssetRoots = {}
  if (stdDir) roots.stdDir = stdDir
  if (config) roots.defaultDir = dirname(config)
  return roots
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function textAsset(path: string): string | undefined {
  try {
    const info = statSync(path)
    if (!info.isFile() || info.size > MAX_ASSET_FILE_BYTES) return undefined
    const buffer = readFileSync(path)
    if (buffer.includes(0)) return undefined
    return buffer.toString('utf8')
  } catch {
    return undefined
  }
}

/** Walk one root without following symlinks, so nothing outside it is read. */
function assetFiles(root: string, prefix: string): Array<{ name: string; path: string }> {
  const found: Array<{ name: string; path: string }> = []
  const visit = (dir: string, relative: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.')) continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(path, name)
        continue
      }
      if (!entry.isFile()) continue
      if (!TEXT_ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      found.push({ name: `${prefix}/${name}`, path })
    }
  }
  visit(root, '')
  return found
}

/**
 * Read the bundled standard packages and default config into a text bundle.
 * Returns undefined when either root is missing or nothing usable is found, so
 * callers fail closed instead of serving a partial bundle.
 */
export function readEngineAssetBundle(
  roots: EngineAssetRoots = engineAssetRoots()
): EngineAssetBundle | undefined {
  const { stdDir, defaultDir } = roots
  if (!stdDir || !defaultDir) return undefined
  if (!isDirectory(stdDir) || !isDirectory(defaultDir)) return undefined
  const sources = [
    { dir: stdDir, prefix: 'std' },
    { dir: defaultDir, prefix: 'default' },
  ]
  const files: Record<string, string> = {}
  let total = 0
  for (const source of sources) {
    for (const file of assetFiles(source.dir, source.prefix)) {
      const text = textAsset(file.path)
      if (text === undefined) continue
      total += Buffer.byteLength(text)
      if (total > MAX_ASSET_BUNDLE_BYTES) return undefined
      files[file.name] = text
    }
  }
  const names = Object.keys(files).sort()
  if (!names.length) return undefined
  const digest = createHash('sha256')
  const sorted: Record<string, string> = {}
  for (const name of names) {
    sorted[name] = files[name]
    digest.update(name)
    digest.update('\0')
    digest.update(files[name])
    digest.update('\0')
  }
  return { version: ENGINE_VERSION, hash: digest.digest('hex'), files: sorted }
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === '*' || value === etag)
}

export function createEngineServer(options: EngineServerOptions): EngineServer {
  const { runtime, token } = options
  const backend = new RuntimeBackend(runtime, options.workspace)
  const mcpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; close: () => void }
  >()
  let assetBundleCache: EngineAssetBundle | undefined
  const assetBundle = (): EngineAssetBundle | undefined => {
    assetBundleCache ??= readEngineAssetBundle()
    return assetBundleCache
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, {
          ok: true,
          service: 'clara-engine',
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
          configSource: options.configPath ? 'file' : 'bundled',
          ...(options.configPath ? { configPath: options.configPath } : {}),
        })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/packages/assets') {
        const bundle = assetBundle()
        if (!bundle) {
          json(res, 503, {
            error: {
              code: 'assets_missing',
              message: 'bundled engine assets are unavailable',
            },
          })
          return
        }
        const etag = `"${bundle.hash}"`
        if (etagMatches(req.headers['if-none-match'], etag)) {
          res.writeHead(304, { etag, 'cache-control': 'private, max-age=0, must-revalidate' })
          res.end()
          return
        }
        json(res, 200, bundle, {
          etag,
          'cache-control': 'private, max-age=0, must-revalidate',
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
        json(res, 200, await backend.catalog(url.searchParams.get('workspace') ?? undefined))
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/diagnostics') {
        json(res, 200, runtime.diagnostics({ days: number(url.searchParams.get('days'), 30) }))
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
      if (url.pathname === '/v1/work/next' && req.method === 'POST') {
        const input = await body(req)
        const capabilities = Array.isArray(input.capabilities)
          ? input.capabilities.filter((item): item is string => typeof item === 'string')
          : []
        const runner =
          input.runner && typeof input.runner === 'object'
            ? {
                id: String((input.runner as Record<string, unknown>).id ?? ''),
                labels: Array.isArray((input.runner as Record<string, unknown>).labels)
                  ? ((input.runner as Record<string, unknown>).labels as unknown[]).filter(
                      (item): item is string => typeof item === 'string'
                    )
                  : [],
              }
            : undefined
        json(
          res,
          200,
          await backend.workNext({
            ...(typeof input.workspace === 'string' ? { workspace: input.workspace } : {}),
            capabilities,
            ...(runner?.id ? { runner } : {}),
            limit: number(input.limit, 1),
          })
        )
        return
      }
      if (url.pathname.match(/^\/v1\/runs\/\d+\/next$/) && req.method === 'POST') {
        const input = await body(req)
        const capabilities = Array.isArray(input.capabilities)
          ? input.capabilities.filter((item): item is string => typeof item === 'string')
          : undefined
        const harness = typeof input.harness === 'string' ? input.harness.trim() : ''
        json(
          res,
          200,
          await backend.next(runID(url), number(input.limit, 1), capabilities, harness || undefined)
        )
        return
      }
      const outputMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/steps\/(.+)\/output$/)
      if (outputMatch && req.method === 'POST') {
        const input = await body(req)
        json(
          res,
          200,
          await backend.output({
            run_id: Number(outputMatch[1]),
            step_path: decode(outputMatch[2]),
            work_token: typeof input.work_token === 'string' ? input.work_token : '',
            stream: input.stream === 'stderr' ? 'stderr' : 'stdout',
            chunk: typeof input.chunk === 'string' ? input.chunk : '',
          })
        )
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
      const deliveryMatch = url.pathname.match(/^\/v1\/runs\/(\d+)\/delivery\/(claim|release)$/)
      if (deliveryMatch && req.method === 'POST') {
        const rid = Number(deliveryMatch[1])
        const input = await body(req)
        const alertIDs = Array.isArray(input.alert_ids)
          ? input.alert_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
          : []
        if (deliveryMatch[2] === 'claim') {
          json(
            res,
            200,
            await backend.claimDelivery(rid, {
              session_id: typeof input.session_id === 'string' ? input.session_id : null,
              terminal: input.terminal === true,
              alert_ids: alertIDs,
            })
          )
        } else {
          json(
            res,
            200,
            await backend.releaseDelivery(rid, {
              terminal: input.terminal === true,
              alert_ids: alertIDs,
            })
          )
        }
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
