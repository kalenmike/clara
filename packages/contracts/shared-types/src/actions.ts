import type { RelayGrantState } from './grant.ts'
import type { AdapterHostIdentity } from './host.ts'
import type { AgentInfo } from './protocol.ts'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type PushSubscriptionKeys = {
  p256dh: string
  auth: string
}

/** The browser shape stored by the hub. */
export type PushSubscriptionPayload = {
  endpoint: string
  expirationTime?: number | null
  keys: PushSubscriptionKeys
}

/** How a paired device presents itself for notification routing. */
export type DeviceClass = 'desktop' | 'mobile'

/**
 * A browser's self-report, attached to the heartbeat. The hub uses it to
 * hold mobile pushes while a desktop client is visibly in use.
 */
export type PresenceSnapshot = {
  deviceClass: DeviceClass
  /** True when this client can raise its own alert and should be treated as the desk. */
  holdPhone: boolean
  visible: boolean
  /** Milliseconds since the last pointer, key, or arrival event. */
  idleMs: number
}

export type PushSubscribeAction = {
  type: 'push.subscribe'
  id?: string
  subscription: PushSubscriptionPayload
  userAgent?: string
  deviceClass?: DeviceClass
  /** True when this device uses orchestrator mode and wants worker alerts held. */
  orchestrationOptIn?: boolean
}

export type PushUnsubscribeAction = {
  type: 'push.unsubscribe'
  id?: string
  endpoint: string
}

export type PushTestAction = {
  type: 'push.test'
  id?: string
  endpoint?: string
}

/** Pull the non-secret client preferences stored for one namespace. */
export type SyncPullAction = {
  type: 'sync.pull'
  id: string
  namespace?: string
}

export type SyncCheckAction = {
  type: 'sync.check'
  id: string
  namespace?: string
}

export type SyncPushAction = {
  type: 'sync.push'
  id: string
  namespace?: string
  baseRevision?: number
  entries: Array<{ key: string; value: string | null }>
}

/** Enrolls a new device over the one-time enrollment session. */
export type DeviceEnrollAction = {
  type: 'device.enroll'
  deviceId: string
  /** Base64url 32-byte device key. */
  key: string
  label?: string
}

/**
 * An adapter asks the hub to forward one engine request. The hub attaches the
 * engine token and returns the response over the same sealed adapter session.
 * This is what lets a remote adapter use an engine it cannot reach directly.
 */
export type EngineRequestAction = {
  type: 'engine.request'
  id: string
  method: HttpMethod
  path: string
  search?: string
  headers?: Record<string, string>
  body?: string
}

export type EngineAbortAction = {
  type: 'engine.abort'
  id: string
}

/**
 * Actions travel from a browser client to the hub. `body` is base64url
 * encoded so the payload stays JSON-safe on every runtime.
 */
export type ClaraAction =
  | {
      type: 'http.request'
      id: string
      method: HttpMethod
      path: string
      search?: string
      headers?: Record<string, string>
      body?: string
    }
  | { type: 'http.abort'; id: string }
  | EngineRequestAction
  | EngineAbortAction
  | { type: 'ping'; at: number; presence?: PresenceSnapshot }
  | { type: 'pong'; at: number }
  | { type: 'ready'; agent: AgentInfo; relayGrant?: RelayGrantState }
  | { type: 'ready.ack'; agent: AgentInfo; host?: AdapterHostIdentity }
  | DeviceEnrollAction
  | PushSubscribeAction
  | PushUnsubscribeAction
  | PushTestAction
  | SyncCheckAction
  | SyncPullAction
  | SyncPushAction

export type ClaraActionType = ClaraAction['type']
