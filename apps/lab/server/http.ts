import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { diffCompiled, inspectSnapshot, type PreviewInput } from '@clara/devtools'
import { repoRoot } from './config.ts'
import { PickerUnavailable, pickDirectory } from './picker.ts'
import type { LabRuntime } from './runtime.ts'
import { checkLabRequest, LAB_HEADER } from './security.ts'
import { loadStaticFiles, SECURITY_HEADERS, serveStatic } from './static.ts'
import { SourceWatcher } from './watcher.ts'

const MAX_BODY_BYTES = 1_000_000
const MAX_SOURCE_BYTES = 512 * 1024

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

export interface LabServerOptions {
  runtime: LabRuntime
  port: number
  version?: string
  log?: (message: string, detail?: unknown) => void
}

export interface LabServer {
  server: Server
  url: string
  port: number
  close(): Promise<void>
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function failure(response: ServerResponse, status: number, code: string, message: string): void {
  json(response, status, { error: { code, message } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'body_too_large', 'request body is too large')
    }
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new HttpError(
      400,
      'invalid_json',
      error instanceof Error ? error.message : 'invalid JSON'
    )
  }
  if (!isRecord(parsed)) throw new HttpError(400, 'invalid_body', 'expected a JSON object')
  return parsed
}

function previewInput(body: Record<string, unknown>): PreviewInput {
  return {
    ...(stringField(body.workspace) ? { workspace: stringField(body.workspace) } : {}),
    ...(stringField(body.configPath) ? { configPath: stringField(body.configPath) } : {}),
    ...(stringField(body.stdDir) ? { stdDir: stringField(body.stdDir) } : {}),
    ...(stringField(body.target) ? { target: stringField(body.target) } : {}),
  }
}

export async function startLabServer(options: LabServerOptions): Promise<LabServer> {
  const runtime = options.runtime
  let files = loadStaticFiles()
  const watcher = new SourceWatcher()
  const streams = new Set<ServerResponse>()
  let allowedSources = new Set<string>()
  let port = options.port

  const server = createServer((request, response) => {
    void handle(request, response).catch((cause) => {
      options.log?.('lab request failed', cause)
      if (!response.headersSent) {
        failure(response, 500, 'internal', 'Clara Lab could not complete the request')
      } else {
        response.end()
      }
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value)
    }

    const check = checkLabRequest(request, port)
    if (!check.ok) {
      failure(response, check.status, 'forbidden', check.message)
      return
    }

    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)

    try {
      if (method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, {
          ok: true,
          service: 'clara-lab',
          version: options.version ?? '0.1.0',
          pid: process.pid,
          port,
          root: repoRoot(),
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
          workspace: runtime.state.workspace,
          orchestratorWorkspace: runtime.state.orchestratorWorkspace,
          orchestrator: runtime.state.orchestrator,
          connected: runtime.state.connected,
          tokenPresent: runtime.state.tokenPresent,
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, runtime.state.snapshot())
        return
      }

      if (method === 'GET' && url.pathname === '/api/stream') {
        streams.add(response)
        response.on('close', () => streams.delete(response))
        streamEvents(request, response, runtime)
        return
      }

      if (method === 'POST') {
        await handlePost(request, response, url, {
          runtime,
          watcher,
          setAllowedSources: (paths) => {
            allowedSources = new Set(paths)
          },
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/source') {
        const path = url.searchParams.get('path')
        if (!path) throw new HttpError(400, 'path_required', 'path query is required')
        if (!allowedSources.has(path)) {
          throw new HttpError(403, 'source_not_allowed', 'This file is not part of the preview')
        }
        const info = await stat(path)
        if (!info.isFile()) throw new HttpError(400, 'not_a_file', 'The path is not a file')
        const text = await readFile(path, 'utf8')
        json(response, 200, {
          path,
          text: text.length > MAX_SOURCE_BYTES ? text.slice(0, MAX_SOURCE_BYTES) : text,
          truncated: text.length > MAX_SOURCE_BYTES,
          bytes: info.size,
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/runs') {
        const result = await runtime.callTool('clara_list', {}, 'ui')
        json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
        return
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/(\d+)$/)
      if (method === 'GET' && runMatch) {
        const result = await runtime.runStatus(Number(runMatch[1]))
        json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
        return
      }

      const stepMatch = url.pathname.match(/^\/api\/runs\/(\d+)\/steps\/(.+)$/)
      if (method === 'GET' && stepMatch) {
        json(
          response,
          200,
          await runtime.stepDetail(Number(stepMatch[1]), decodeURIComponent(stepMatch[2]))
        )
        return
      }

      if (method === 'GET' && url.pathname === '/api/opencode/sessions') {
        json(response, 200, await runtime.opencodeSessions())
        return
      }

      if (method === 'GET' && url.pathname === '/api/inbox') {
        const result = await runtime.callTool('clara_inbox', {}, 'ui')
        json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
        return
      }

      if (method === 'GET' && url.pathname === '/api/tools') {
        json(response, 200, runtime.state.tools)
        return
      }

      if (!files.index) files = loadStaticFiles()
      if (
        (method === 'GET' || method === 'HEAD') &&
        serveStatic(response, method, url.pathname, files)
      ) {
        return
      }

      if (!files.index && (method === 'GET' || method === 'HEAD')) {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(
          `Clara Lab web assets were not found in ${files.root}. Run \`pnpm build\` and reload.\n`
        )
        return
      }

      failure(response, 404, 'not_found', `${method} ${url.pathname}`)
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 502
      const code = cause instanceof HttpError ? cause.code : 'orchestrator_error'
      const message = cause instanceof Error ? cause.message : String(cause)
      failure(response, status, code, message)
    }
  }

  async function handlePost(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    context: {
      runtime: LabRuntime
      watcher: SourceWatcher
      setAllowedSources: (paths: string[]) => void
    }
  ): Promise<void> {
    if (request.headers[LAB_HEADER] !== '1') {
      throw new HttpError(403, 'missing_lab_header', `Mutations require ${LAB_HEADER}: 1`)
    }
    const body = await readBody(request)

    if (url.pathname === '/api/preview') {
      const input = previewInput(body)
      const result = await context.runtime.preview(input)
      context.setAllowedSources(result.sources.map((source) => source.path))
      if (result.workspace) {
        context.runtime.state.workspace = result.workspace.workspace
      }
      const target = input.target ?? result.selected?.ref ?? ''
      const previewKey = { workspace: result.workspace?.workspace ?? '', target }
      const directories = [
        ...(result.workspace ? [join(result.workspace.workspace, 'orchestration')] : []),
        ...(result.catalog?.packages.flatMap((pkg) => [
          pkg.dir,
          join(pkg.dir, 'pipelines'),
          join(pkg.dir, 'routers'),
          join(pkg.dir, 'agents'),
          join(pkg.dir, 'scripts'),
        ]) ?? []),
      ]
      context.watcher.watch(
        result.sources.map((source) => source.path),
        directories,
        () => context.runtime.state.emit('preview', { ...previewKey, reason: 'changed' })
      )
      json(response, 200, result)
      return
    }

    if (url.pathname === '/api/reconnect') {
      await context.runtime.reconnect()
      json(response, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/runs/cancel-all') {
      json(response, 200, await context.runtime.cancelAll())
      return
    }

    if (url.pathname === '/api/opencode/reconnect') {
      await context.runtime.reconnectOpenCode()
      json(response, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/pick-directory') {
      const initial = stringField(body.initial)
      try {
        const path = await pickDirectory(initial)
        json(response, 200, { path: path ?? null })
      } catch (error) {
        if (error instanceof PickerUnavailable) {
          throw new HttpError(501, 'picker_unavailable', error.message)
        }
        throw error
      }
      return
    }

    if (url.pathname === '/api/preflight') {
      const hostWorkspace = stringField(body.hostWorkspace) ?? context.runtime.state.workspace
      const runtimeWorkspace = stringField(body.runtimeWorkspace)
      const target = stringField(body.target)
      const result = await context.runtime.preflight({
        hostWorkspace,
        ...(runtimeWorkspace ? { runtimeWorkspace } : {}),
        ...(target ? { target } : {}),
      })
      json(response, 200, result)
      return
    }

    if (url.pathname === '/api/diff') {
      const runID = Number(body.run_id)
      if (!Number.isInteger(runID)) {
        throw new HttpError(400, 'invalid_body', 'run_id is required')
      }
      const preview = await context.runtime.preview(previewInput(body))
      if (!preview.compiled) {
        json(response, 422, {
          error: {
            code: 'preview_failed',
            message: 'The current target does not compile',
          },
          diagnostics: preview.diagnostics,
        })
        return
      }
      const pinned = await context.runtime.pinnedSnapshot(runID).catch((error: unknown) => {
        throw new HttpError(
          422,
          'run_missing',
          error instanceof Error ? error.message : `Run ${runID} has no pinned snapshot`
        )
      })
      json(response, 200, {
        currentHash: preview.compiled.hash,
        runHash: pinned.hash,
        diff: diffCompiled(preview.compiled.root, inspectSnapshot(pinned.snapshot)),
      })
      return
    }

    if (url.pathname === '/api/heartbeat') {
      if (typeof body.enabled !== 'boolean') {
        throw new HttpError(400, 'invalid_body', 'enabled must be a boolean')
      }
      context.runtime.state.setHeartbeat(body.enabled)
      json(response, 200, { enabled: body.enabled })
      return
    }

    if (url.pathname === '/api/adapter/register') {
      const workspace =
        stringField(body.workspace) ||
        context.runtime.state.orchestratorWorkspace ||
        context.runtime.state.workspace
      const result = await context.runtime.registerAdapter(workspace)
      json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
      return
    }

    if (url.pathname === '/api/adapter/remove') {
      const id = stringField(body.id)
      if (!id) throw new HttpError(400, 'id_required', 'id is required')
      const result = await context.runtime.removeAdapter(id)
      json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
      return
    }

    if (url.pathname === '/api/violation') {
      const runID = Number(body.run_id)
      const stepPath = stringField(body.step_path)
      const reason = stringField(body.reason) ?? 'policy violation'
      if (!Number.isInteger(runID) || !stepPath) {
        throw new HttpError(400, 'invalid_body', 'run_id and step_path are required')
      }
      const value = await context.runtime.violation(runID, stepPath, reason)
      json(response, 200, { ok: true, value })
      return
    }

    const toolMatch = url.pathname.match(/^\/api\/tools\/([a-z0-9_]+)$/)
    if (toolMatch) {
      const result = await context.runtime.callTool(toolMatch[1], body, 'ui')
      json(response, 200, { ok: !result.isError, isError: result.isError, value: result.value })
      return
    }

    throw new HttpError(404, 'not_found', `POST ${url.pathname}`)
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address()
      if (bound && typeof bound !== 'string') port = bound.port
      resolve()
    })
  })
  const address = server.address() as AddressInfo | string | null
  if (!address || typeof address === 'string') {
    throw new Error('Clara Lab did not report a TCP address')
  }
  port = address.port

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}/`,
    async close() {
      watcher.stop()
      for (const stream of streams) stream.end()
      streams.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: LabRuntime
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  response.write('retry: 1000\n\n')
  const snapshot = {
    seq: 0,
    type: 'snapshot',
    at: new Date().toISOString(),
    data: runtime.state.snapshot(),
  }
  response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)

  const unsubscribe = runtime.state.subscribe((item) => {
    if (!response.writableEnded) {
      response.write(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`)
    }
  })
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(': heartbeat\n\n')
  }, 15_000)
  heartbeat.unref?.()

  const close = (): void => {
    clearInterval(heartbeat)
    unsubscribe()
    response.end()
  }
  request.on('close', close)
  response.on('close', close)
}
