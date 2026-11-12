import type { AgentInfo } from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'

export type ApiDependencies = {
  harness: HarnessManager
  info: AgentInfo
  startedAt: number
  canAccess: () => boolean
  sessionCount: () => number
  log: (message: string, detail?: unknown) => void
}

export type ApiApp = {
  fetch: (request: Request) => Promise<Response>
  openapi: () => Promise<Record<string, unknown>>
}

export type ApiVariables = {
  authenticated: boolean
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}
