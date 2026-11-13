import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PanelAuthInfo, PanelSnapshot } from '@clara/shared-types'
import type { PanelAuthUser } from './auth.ts'

export type PanelFeatureJsonBody =
  { ok: true; value: unknown } | { ok: false; status: number; code: string; message: string }

export type PanelFeatureRequest = {
  request: IncomingMessage
  response: ServerResponse
  method: string
  pathname: string
  user: PanelAuthUser
  auth: PanelAuthInfo
  readJson: () => Promise<PanelFeatureJsonBody>
  sendJson: (status: number, body: unknown, headers?: Record<string, string>) => void
  requireMutation: (requireJson?: boolean) => boolean
  log: (message: string, detail?: unknown) => void
}

/**
 * An optional, authenticated panel surface. The core calls it after the normal
 * session check and before the built-in panel routes. Returning false means
 * the path belongs to the core.
 */
export type PanelFeature = {
  handleRequest: (context: PanelFeatureRequest) => Promise<boolean>
  decorateSnapshot?: (snapshot: PanelSnapshot) => void | Promise<void>
}
