import { OpenCode } from '@opencode/client'
import type { OpenCodeClient as SdkOpenCodeClient } from '@opencode/client'
import { AdapterError } from './errors.ts'

export type OpenCodeProbe = {
  ok: boolean
  version?: string
  status?: number
  latencyMs: number
  code: 'ok' | 'timeout' | 'auth' | 'http' | 'unreachable'
  message?: string
}

export type OpenCodeGatewayOptions = {
  url: string
  username?: string
  password?: string
  fetch?: typeof globalThis.fetch
}

const NOT_FOUND_TAGS = new Set([
  'AgentNotFoundError',
  'CommandNotFoundError',
  'FileNotFoundError',
  'FormNotFoundError',
  'IntegrationAttemptNotFoundError',
  'IntegrationMethodNotFoundError',
  'IntegrationNotFoundError',
  'LocationNotFoundError',
  'McpServerNotFoundError',
  'MessageNotFoundError',
  'PermissionNotFoundError',
  'PermissionSavedNotFoundError',
  'ProjectNotFoundError',
  'ProviderNotFoundError',
  'PtyNotFoundError',
  'SessionNotFoundError',
  'ShellNotFoundError',
  'SkillNotFoundError',
])

const CONFLICT_TAGS = new Set([
  'ConflictError',
  'FormAlreadySettledError',
  'SessionBusyError',
  'WorktreeError',
])

const BAD_REQUEST_TAGS = new Set([
  'FormInvalidAnswerError',
  'InvalidCursorError',
  'InvalidRequestError',
])

const SERVER_TAGS = new Set([
  'CommandExecutionError',
  'RpcError',
  'RpcInternalError',
  'UnknownError',
])

/** The adapter's OpenCode access point. The SDK owns routes, types, and SSE parsing. */
export class OpenCodeGateway {
  readonly client: SdkOpenCodeClient

  constructor(options: OpenCodeGatewayOptions) {
    const username = options.username || 'opencode'
    this.client = OpenCode.make({
      baseUrl: options.url.replace(/\/+$/, ''),
      ...(options.password
        ? {
            headers: {
              authorization: `Basic ${Buffer.from(`${username}:${options.password}`).toString('base64')}`,
            },
          }
        : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  async reload(timeoutMs = 5_000): Promise<void> {
    try {
      await this.client.location.reload({ signal: AbortSignal.timeout(timeoutMs) })
    } catch (cause) {
      const status = errorStatus(cause)
      throw new Error(
        status
          ? `OpenCode reload failed (${status})`
          : `OpenCode reload failed: ${errorMessage(cause)}`,
        { cause }
      )
    }
  }

  async probe(timeoutMs = 2_000): Promise<OpenCodeProbe> {
    const started = Date.now()
    try {
      const info = await this.client.server.info({ signal: AbortSignal.timeout(timeoutMs) })
      return {
        ok: true,
        latencyMs: Date.now() - started,
        code: 'ok',
        ...(info.version ? { version: info.version } : {}),
      }
    } catch (cause) {
      const latencyMs = Date.now() - started
      const status = errorStatus(cause)
      if (status === 401 || status === 403) {
        return {
          ok: false,
          status,
          latencyMs,
          code: 'auth',
          message: `OpenCode rejected the password (${status})`,
        }
      }
      if (isTimeout(cause)) {
        return {
          ok: false,
          latencyMs,
          code: 'timeout',
          message: `OpenCode did not answer within ${timeoutMs}ms`,
        }
      }
      if (status !== undefined) {
        return {
          ok: false,
          status,
          latencyMs,
          code: 'http',
          message: `OpenCode responded with ${status}`,
        }
      }
      return {
        ok: false,
        latencyMs,
        code: 'unreachable',
        message: errorMessage(cause),
      }
    }
  }
}

/**
 * Translate SDK and declared OpenCode errors into the adapter's wire shape.
 * The SDK keeps the HTTP status only for undeclared responses, so declared
 * errors are mapped from their `_tag`.
 */
export function toAdapterError(cause: unknown): AdapterError {
  if (isAbort(cause)) throw cause

  const status = errorStatus(cause)
  const tag = errorTag(cause)
  const message = errorMessage(cause)

  if (status === 401 || status === 403 || tag === 'UnauthorizedError' || tag === 'ForbiddenError') {
    return new AdapterError(
      502,
      'harness_auth',
      message || 'OpenCode rejected the adapter credentials'
    )
  }

  if (status !== undefined) {
    return new AdapterError(
      status >= 500 ? 502 : status,
      tag ?? 'upstream_error',
      message || `OpenCode responded with ${status}`
    )
  }

  return new AdapterError(502, tag ?? 'upstream_error', message)
}

function errorStatus(cause: unknown): number | undefined {
  if (!isRecord(cause)) return undefined
  if (typeof cause.status === 'number') return cause.status

  if (isRecord(cause.cause) && typeof cause.cause.status === 'number') return cause.cause.status
  if (typeof cause.reason === 'string' && cause.reason === 'UnexpectedStatus') {
    if (isRecord(cause.cause) && typeof cause.cause.status === 'number') return cause.cause.status
  }

  const tag = typeof cause._tag === 'string' ? cause._tag : undefined
  if (tag === 'UnauthorizedError') return 401
  if (tag === 'ForbiddenError') return 403
  if (NOT_FOUND_TAGS.has(tag ?? '')) return 404
  if (CONFLICT_TAGS.has(tag ?? '')) return 409
  if (BAD_REQUEST_TAGS.has(tag ?? '')) return 400
  if (tag === 'InstructionEntryValueTooLargeError') return 413
  if (tag === 'ServiceUnavailableError') return 503
  if (tag === 'VcsInitNotSupportedError') return 501
  if (SERVER_TAGS.has(tag ?? '')) return 500
  return undefined
}

function errorTag(cause: unknown): string | undefined {
  if (isRecord(cause)) {
    if (typeof cause._tag === 'string') return cause._tag
    if (typeof cause.name === 'string' && cause.name !== 'Error' && cause.name !== 'ClientError') {
      return cause.name
    }
  }
  return undefined
}

function errorMessage(cause: unknown): string {
  if (isRecord(cause)) {
    if (typeof cause.message === 'string' && cause.message) return cause.message
    if (isRecord(cause.data) && typeof cause.data.message === 'string' && cause.data.message) {
      return cause.data.message
    }
    if (typeof cause.detail === 'string' && cause.detail) return cause.detail
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function isTimeout(cause: unknown): boolean {
  return hasCauseName(cause, 'TimeoutError')
}

function isAbort(cause: unknown): boolean {
  return hasCauseName(cause, 'AbortError')
}

function hasCauseName(cause: unknown, name: string): boolean {
  let current: unknown = cause
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (current instanceof Error && current.name === name) return true
    if (!isRecord(current)) return false
    current = current.cause
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
