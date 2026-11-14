import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PiThinkingLevel, PiTrust } from '../config.ts'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_LINE_BYTES = 64 * 1024 * 1024
const STDERR_TAIL_BYTES = 16 * 1024

export type PiRpcRecord = Record<string, unknown> & { type: string }

export type PiRpcResponse = PiRpcRecord & {
  type: 'response'
  id?: string
  command?: string
  success?: boolean
  data?: unknown
  error?: string
}

export type PiUiRequest = PiRpcRecord & {
  type: 'extension_ui_request'
  id: string
  method: string
}

export type PiModel = {
  id: string
  name: string
  provider: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
}

export type PiState = {
  model?: PiModel
  thinkingLevel?: string
  isStreaming?: boolean
  isCompacting?: boolean
  sessionFile?: string
  sessionId?: string
  sessionName?: string
  messageCount?: number
}

export type PiRpcOptions = {
  binary: string
  cwd: string
  env: NodeJS.ProcessEnv
  sessionFile?: string
  sessionId?: string
  name?: string
  noSession?: boolean
  model?: string
  thinkingLevel?: PiThinkingLevel
  trust?: PiTrust
  requestTimeoutMs?: number
}

export class PiRpcError extends Error {
  readonly command?: string
  readonly data?: unknown

  constructor(message: string, options: { command?: string; data?: unknown } = {}) {
    super(message)
    this.name = 'PiRpcError'
    if (options.command !== undefined) this.command = options.command
    if (options.data !== undefined) this.data = options.data
  }
}

type Pending = {
  command: string
  resolve: (value: unknown) => void
  reject: (cause: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * One long-lived `pi --mode rpc` child. stdout is strict JSONL: never use
 * readline here, because it also splits on U+2028 and U+2029.
 */
export class PiRpcClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly requestTimeoutMs: number
  private readonly pending = new Map<string, Pending>()
  private readonly eventListeners = new Set<(event: PiRpcRecord) => void>()
  private readonly uiListeners = new Set<(request: PiUiRequest) => void>()
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>()
  private buffer = ''
  private counter = 0
  private stderr = ''
  private closed = false
  private exited = false
  private closing = false
  private exitCode: number | null = null
  private exitSignal: string | null = null

  private constructor(child: ChildProcessWithoutNullStreams, requestTimeoutMs: number) {
    this.child = child
    this.requestTimeoutMs = requestTimeoutMs
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL_BYTES)
      if (process.env.CLARA_ADAPTER_DEBUG === '1') console.error(`[pi] ${chunk}`)
    })
    child.on('error', (cause) => this.failAll(cause))
    child.on('exit', (code, signal) => {
      this.exited = true
      this.exitCode = code
      this.exitSignal = signal
      this.failAll(new PiRpcError(this.exitMessage()))
      for (const listener of this.exitListeners) {
        try {
          listener(code, signal)
        } catch {
          // Listener failures must not hide the exit.
        }
      }
    })
  }

  static start(options: PiRpcOptions): Promise<PiRpcClient> {
    const args = rpcArgs(options)
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(options.binary, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (cause) {
        reject(cause)
        return
      }
      const client = new PiRpcClient(child, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      const fail = (cause: unknown) => reject(cause)
      child.once('error', fail)
      child.once('spawn', () => {
        child.off('error', fail)
        resolve(client)
      })
    })
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  get alive(): boolean {
    return !this.closed && !this.exited && !this.closing
  }

  get stderrTail(): string {
    return this.stderr.trim()
  }

  onEvent(listener: (event: PiRpcRecord) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onUiRequest(listener: (request: PiUiRequest) => void): () => void {
    this.uiListeners.add(listener)
    return () => this.uiListeners.delete(listener)
  }

  onExit(listener: (code: number | null, signal: string | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  request<T = unknown>(
    command: Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs
  ): Promise<T> {
    if (!this.alive) return Promise.reject(new PiRpcError(this.exitMessage()))
    const id = `clara-${++this.counter}`
    const record = { ...command, id }
    const name = typeof command.type === 'string' ? command.type : 'command'
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new PiRpcError(`Pi did not answer ${name} within ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        command: name,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.send(record, reject)
    })
  }

  /** Respond to an `extension_ui_request` dialog. */
  respond(record: Record<string, unknown>): void {
    this.send({ type: 'extension_ui_response', ...record }, () => {})
  }

  async close(graceMs = 3_000): Promise<void> {
    if (this.closed || this.exited) {
      this.finishClose()
      return
    }
    this.closing = true
    this.failAll(new PiRpcError('The Pi process is closing'))
    try {
      this.child.stdin.end()
    } catch {
      // Already closed.
    }
    if (await waitForExit(this.child, graceMs)) return
    try {
      this.child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    if (await waitForExit(this.child, 2_000)) return
    try {
      this.child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
    await waitForExit(this.child, 1_000)
  }

  private finishClose(): void {
    this.closed = true
    for (const listener of this.exitListeners) {
      try {
        listener(this.exitCode, this.exitSignal)
      } catch {
        // Already closing.
      }
    }
  }

  private send(record: Record<string, unknown>, reject: (cause: unknown) => void): void {
    try {
      this.child.stdin.write(`${JSON.stringify(record)}\n`)
    } catch (cause) {
      reject(cause)
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      this.consume(line)
    }
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.buffer = ''
      this.failAll(new PiRpcError('Pi wrote a protocol line larger than the adapter limit'))
    }
  }

  private consume(line: string): void {
    let record: PiRpcRecord
    try {
      const parsed: unknown = JSON.parse(line)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as { type?: unknown }).type !== 'string'
      ) {
        return
      }
      record = parsed as PiRpcRecord
    } catch {
      return
    }
    if (record.type === 'response') {
      this.settle(record as PiRpcResponse)
      return
    }
    if (record.type === 'extension_ui_request') {
      for (const listener of this.uiListeners) {
        try {
          listener(record as PiUiRequest)
        } catch {
          // A UI handler failure must not stop the stream.
        }
      }
      return
    }
    for (const listener of this.eventListeners) {
      try {
        listener(record)
      } catch {
        // A stream handler failure must not stop the process.
      }
    }
  }

  private settle(response: PiRpcResponse): void {
    let id = typeof response.id === 'string' ? response.id : undefined
    if (!id) {
      const candidate = [...this.pending.entries()].find(([, pending]) => {
        return pending.command === response.command
      })
      id = candidate?.[0]
    }
    if (!id) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (response.success === false) {
      pending.reject(
        new PiRpcError(response.error ?? `Pi rejected ${response.command ?? pending.command}`, {
          ...(response.command ? { command: response.command } : {}),
          ...(response.data !== undefined ? { data: response.data } : {}),
        })
      )
      return
    }
    pending.resolve(response.data)
  }

  private failAll(cause: unknown): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(cause)
    }
  }

  private exitMessage(): string {
    const tail = this.stderr.trim()
    const reason =
      this.exitCode !== null
        ? `exited with code ${this.exitCode}`
        : this.exitSignal
          ? `exited on ${this.exitSignal}`
          : 'is not running'
    return `Pi ${reason}${tail ? `: ${tail}` : ''}`
  }
}

export function rpcArgs(options: PiRpcOptions): string[] {
  const args = ['--mode', 'rpc']
  if (options.noSession) args.push('--no-session')
  else if (options.sessionFile) args.push('--session', options.sessionFile)
  else if (options.sessionId) args.push('--session-id', options.sessionId)
  if (options.name && !options.sessionFile) args.push('--name', options.name)
  if (options.model) args.push('--model', options.model)
  if (options.thinkingLevel) args.push('--thinking', options.thinkingLevel)
  if (options.trust === 'always') args.push('--approve')
  if (options.trust === 'never') args.push('--no-approve')
  return args
}

/** Start a throwaway RPC process, ask for state, and shut it down. */
export async function probePiRpc(
  binary: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: { trust?: PiTrust } = {}
): Promise<PiState> {
  const client = await PiRpcClient.start({
    binary,
    cwd,
    env,
    noSession: true,
    requestTimeoutMs: 15_000,
    ...(options.trust ? { trust: options.trust } : {}),
  })
  try {
    return await client.request<PiState>({ type: 'get_state' }, 15_000)
  } finally {
    await client.close(2_000)
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    timer.unref?.()
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}
