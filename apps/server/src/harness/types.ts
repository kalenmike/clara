import type { HttpRequestAction } from '../opencode.ts'

export type HarnessKind = 'opencode'
export type HarnessAuthType = 'none' | 'basic'

export type HarnessConnection = {
  id: string
  kind: HarnessKind
  label: string
  baseUrl: string
  authType: HarnessAuthType
  username?: string
  options: Record<string, unknown>
  isActive: boolean
  lastTestAt?: number
  lastTestOk?: boolean
  lastTestError?: string
  createdAt: number
  updatedAt: number
  secretConfigured: boolean
}

export type HarnessCandidate = {
  kind: HarnessKind
  label: string
  baseUrl: string
  authType: HarnessAuthType
  username?: string
  /** Absent or empty on an edit means "keep the existing secret". */
  password?: string
  options?: Record<string, unknown>
}

export type HarnessProbe = {
  ok: boolean
  version?: string
  status?: number
  latencyMs: number
  code:
    'ok' | 'timeout' | 'auth' | 'http' | 'unreachable' | 'disabled' | 'unconfigured' | 'unsupported'
  message?: string
}

export type HarnessRequest = {
  request(action: HttpRequestAction, signal: AbortSignal): Promise<Response>
}

export type HarnessClient = HarnessRequest & {
  readonly kind: HarnessKind
  probe(timeoutMs?: number): Promise<HarnessProbe>
  reload?(timeoutMs?: number): Promise<void>
}

export class HarnessUnconfiguredError extends Error {
  readonly code = 'harness_unconfigured'

  constructor(message = 'No harness connection is configured') {
    super(message)
    this.name = 'HarnessUnconfiguredError'
  }
}

export class HarnessValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'HarnessValidationError'
    this.code = code
  }
}
