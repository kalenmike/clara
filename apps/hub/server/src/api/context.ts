import type {
  AdapterInstallMethod,
  AdapterInstallOffer,
  AgentInfo,
  PanelInstallManifest,
} from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'

/** The live loopback panel listener the tunnel bridge forwards to. */
export type PanelEndpoint = {
  host: string
  port: number
}

/** The lab service that runs next to the engine. */
export type LabEndpoint = {
  url: string
  token?: string
}

export type ApiDependencies = {
  harness: HarnessManager
  info: AgentInfo
  startedAt: number
  canAccess: () => boolean
  sessionCount: () => number
  createAdapterPairing?: (input: {
    kind: string
    method?: AdapterInstallMethod
  }) => Promise<AdapterInstallOffer>
  adapterManifest?: (kind: string) => Promise<PanelInstallManifest>
  /**
   * Resolved lazily because the API app is created before the panel server
   * starts, and the panel may be disabled or fail to bind.
   */
  panel?: () => PanelEndpoint | undefined
  /** Resolved lazily; the lab service may be started after the hub. */
  lab?: () => LabEndpoint | undefined
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
