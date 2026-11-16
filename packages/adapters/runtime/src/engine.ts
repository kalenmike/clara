import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToBase64Url, randomBytes } from '@clara/crypto'
import type { AgentEngineInfo, EngineEndpointConfig } from '@clara/shared-types'
import { claraPaths } from './paths.ts'
import type { AdapterTransport } from './transport.ts'

const PROBE_TIMEOUT_MS = 900
const PROBE_LIMIT = 8
const MAX_BODY_BYTES = 10 * 1024 * 1024

export function engineConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraPaths(env).dataDir, 'engine.json')
}

export function engineTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraPaths(env).dataDir, 'engine.token')
}

export function readEngineConfig(
  env: NodeJS.ProcessEnv = process.env
): EngineEndpointConfig | undefined {
  const path = engineConfigPath(env)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<EngineEndpointConfig>
    if (
      typeof parsed.enabled !== 'boolean' ||
      (parsed.mode !== 'direct' && parsed.mode !== 'proxy' && parsed.mode !== 'none')
    ) {
      return undefined
    }
    return {
      enabled: parsed.enabled,
      mode: parsed.mode,
      ...(typeof parsed.url === 'string' && parsed.url ? { url: parsed.url } : {}),
      ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
      ...(typeof parsed.reason === 'string' && parsed.reason ? { reason: parsed.reason } : {}),
    }
  } catch {
    return undefined
  }
}

export function writeEngineConfig(
  config: EngineEndpointConfig,
  env: NodeJS.ProcessEnv = process.env
): void {
  const path = engineConfigPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ ...config, updatedAt: Date.now() }, null, 2)}\n`, {
    mode: 0o600,
  })
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on platforms without POSIX modes.
  }
}

export function writeEngineToken(token: string, env: NodeJS.ProcessEnv = process.env): void {
  const path = engineTokenPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${token}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on platforms without POSIX modes.
  }
}

export function readEngineToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = engineTokenPath(env)
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

type EngineOrchestratorOptions = {
  transport: Pick<AdapterTransport, 'fetchEngine'>
  env?: NodeJS.ProcessEnv
  probeTimeoutMs?: number
  log?: (message: string, detail?: unknown) => void
}

/**
 * Resolve where this adapter machine should send engine traffic. The hub sends
 * a descriptor on every authenticated connect; direct candidates are probed
 * from this machine, and a local loopback gateway carries the sealed proxy
 * path for the plugin, runner, and MCP client.
 */
export class EngineOrchestrator {
  private readonly transport: Pick<AdapterTransport, 'fetchEngine'>
  private readonly env: NodeJS.ProcessEnv
  private readonly probeTimeoutMs: number
  private readonly log?: (message: string, detail?: unknown) => void
  private gateway?: EngineGateway
  private lastSignature = ''
  private running = false
  /** `undefined` means idle; `null` means resolve as disabled. */
  private queued?: AgentEngineInfo | null
  private closed = false

  constructor(options: EngineOrchestratorOptions) {
    this.transport = options.transport
    this.env = options.env ?? process.env
    this.probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS
    this.log = options.log
  }

  async update(info: AgentEngineInfo | undefined): Promise<void> {
    if (this.closed) return
    const signature = JSON.stringify(info ?? null)
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.queued = info ?? null
    if (this.running) return
    this.running = true
    try {
      while (this.queued !== undefined) {
        const next = this.queued
        this.queued = undefined
        await this.apply(next ?? undefined)
      }
    } finally {
      this.running = false
    }
  }

  async close(): Promise<void> {
    this.closed = true
    await this.gateway?.close()
    this.gateway = undefined
  }

  private async apply(info: AgentEngineInfo | undefined): Promise<void> {
    if (this.closed) return
    if (!info?.enabled) {
      await this.gateway?.close()
      this.gateway = undefined
      writeEngineConfig(
        {
          enabled: false,
          mode: 'none',
          reason: 'Clara orchestration is not running',
        },
        this.env
      )
      return
    }

    const token = info.token?.trim() || readEngineToken(this.env)
    const direct = await this.probeDirect(info.direct ?? [], token)
    if (direct) {
      if (token) writeEngineToken(token, this.env)
      await this.gateway?.close()
      this.gateway = undefined
      writeEngineConfig(
        {
          enabled: true,
          mode: 'direct',
          url: direct,
        },
        this.env
      )
      this.log?.(`using the engine directly at ${direct}`)
      return
    }

    if (!info.proxy) {
      await this.gateway?.close()
      this.gateway = undefined
      writeEngineConfig(
        {
          enabled: false,
          mode: 'none',
          reason: 'No reachable engine endpoint and the hub proxy is disabled',
        },
        this.env
      )
      return
    }

    try {
      if (!this.gateway) this.gateway = new EngineGateway(this.transport, this.log)
      const url = await this.gateway.start()
      writeEngineConfig(
        {
          enabled: true,
          mode: 'proxy',
          url,
          token: this.gateway.token,
        },
        this.env
      )
      this.log?.(`using the hub engine proxy at ${url}`)
    } catch (cause) {
      await this.gateway?.close()
      this.gateway = undefined
      writeEngineConfig(
        {
          enabled: false,
          mode: 'none',
          reason: cause instanceof Error ? cause.message : String(cause),
        },
        this.env
      )
      this.log?.('could not start the engine gateway', cause)
    }
  }

  private async probeDirect(urls: readonly string[], token: string | undefined): Promise<string> {
    for (const raw of urls.slice(0, PROBE_LIMIT)) {
      const url = raw.replace(/\/+$/, '')
      if (!url) continue
      try {
        const health = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(this.probeTimeoutMs),
        })
        if (!health.ok) continue
        if (token) {
          const config = await fetch(`${url}/v1/config`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(this.probeTimeoutMs),
          })
          if (!config.ok) continue
        }
        return url
      } catch {
        // Try the next candidate.
      }
    }
    return ''
  }
}

type GatewayRequest = {
  body: Buffer
}

/**
 * A loopback HTTP server on the adapter machine. It is not a hub-facing port:
 * it requires a random per-process bearer and only forwards to the sealed
 * adapter session.
 */
export class EngineGateway {
  private readonly transport: Pick<AdapterTransport, 'fetchEngine'>
  private readonly log?: (message: string, detail?: unknown) => void
  private server?: Server
  private listening?: Promise<string>
  readonly token = bytesToBase64Url(randomBytes(24))

  constructor(
    transport: Pick<AdapterTransport, 'fetchEngine'>,
    log?: (message: string, detail?: unknown) => void
  ) {
    this.transport = transport
    this.log = log
  }

  async start(): Promise<string> {
    if (this.server) return this.listening as Promise<string>
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
    this.listening = new Promise<string>((resolve, reject) => {
      const server = this.server
      if (!server) return reject(new Error('The engine gateway is not available'))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('The engine gateway did not bind a TCP port'))
          return
        }
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
    return this.listening
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.listening = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      writeJson(response, 401, { error: 'unauthorized' })
      return
    }
    const path = request.url ?? '/'
    if (!path.startsWith('/v1/')) {
      writeJson(response, 404, { error: 'Unknown engine endpoint' })
      return
    }
    let body: GatewayRequest['body']
    try {
      body = await readBody(request)
    } catch (cause) {
      writeJson(response, 413, {
        error: cause instanceof Error ? cause.message : 'Request body is too large',
      })
      return
    }
    const controller = new AbortController()
    response.once('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        if (name === 'authorization' || name === 'host' || name === 'connection') continue
        for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry)
      }
      const target = new URL(path, 'http://127.0.0.1')
      const upstream = await this.transport.fetchEngine(
        new Request(target, {
          method: request.method ?? 'GET',
          headers,
          ...(body.byteLength > 0 && request.method !== 'GET' && request.method !== 'HEAD'
            ? { body: new Uint8Array(body) }
            : {}),
          signal: controller.signal,
        })
      )
      response.statusCode = upstream.status
      response.statusMessage = upstream.statusText
      upstream.headers.forEach((value, name) => {
        if (name === 'connection' || name === 'transfer-encoding' || name === 'content-length') {
          return
        }
        response.setHeader(name, value)
      })
      if (!upstream.body) {
        response.end()
        return
      }
      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) response.write(Buffer.from(value))
        }
      } finally {
        reader.releaseLock()
      }
      response.end()
    } catch (cause) {
      if (!response.headersSent) {
        writeJson(response, 502, {
          error: cause instanceof Error ? cause.message : 'The engine request failed',
        })
      } else {
        response.destroy()
      }
      this.log?.('engine gateway request failed', cause)
    }
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        reject(new Error('The engine request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}
