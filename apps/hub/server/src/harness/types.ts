import type { HarnessHost, HarnessInstallMethod, HttpMethod } from '@clara/shared-types'

export type HarnessKind = string
export type HarnessTransport = 'local' | 'relay'

export type HarnessConnection = {
  id: string
  harnessId: string
  kind: HarnessKind
  label: string
  transport: HarnessTransport
  online: boolean
  /** The machine or container the adapter reports, plus its install method. */
  host?: HarnessHost
  /** Fingerprint of the paired adapter credential. */
  fingerprint?: string
  adapterVersion?: string
  adapterInstalledAt?: number
  protocolVersion?: number
  harnessVersion?: string
  capabilities: Record<string, unknown>
  credentialConfigured: boolean
  lastTestAt?: number
  lastTestOk?: boolean
  lastTestError?: string
  lastSeenAt?: number
  createdAt: number
  updatedAt: number
  forgottenAt?: number
}

export type HarnessProbe = {
  ok: boolean
  version?: string
  status?: number
  latencyMs: number
  code:
    | 'ok'
    | 'timeout'
    | 'auth'
    | 'http'
    | 'unreachable'
    | 'disabled'
    | 'unconfigured'
    | 'offline'
    | 'unsupported'
  message?: string
}

export type HarnessRequestInput = {
  method: HttpMethod
  path: string
  search?: string
  headers?: Record<string, string>
  body?: string
}

export type HarnessRequest = {
  request(input: HarnessRequestInput, signal: AbortSignal): Promise<Response>
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

export class HarnessOfflineError extends Error {
  readonly code = 'harness_offline'

  constructor(message = 'The harness adapter is offline') {
    super(message)
    this.name = 'HarnessOfflineError'
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

export type AdapterCredential = {
  adapterId: string
  harnessId: string
  label: string
  key: string
  fingerprint: string
  createdAt: number
  revokedAt?: number
}

export type HarnessPairing = {
  id: string
  kind: string
  label: string
  token: string
  fingerprint: string
  createdAt: number
  expiresAt: number
  /** Recorded from the panel install flow; absent for a plain pairing code. */
  installMethod?: HarnessInstallMethod
}
