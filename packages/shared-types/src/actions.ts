import type { AgentInfo } from './protocol.ts'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type PushSubscriptionKeys = {
  p256dh: string
  auth: string
}

/** The browser shape stored by the home agent. */
export type PushSubscriptionPayload = {
  endpoint: string
  expirationTime?: number | null
  keys: PushSubscriptionKeys
}

export type PushSubscribeAction = {
  type: 'push.subscribe'
  id?: string
  subscription: PushSubscriptionPayload
  userAgent?: string
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

/**
 * Actions travel from a browser client to the home agent. `body` is base64url
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
  | { type: 'ping'; at: number }
  | { type: 'pong'; at: number }
  | { type: 'ready'; agent: AgentInfo }
  | { type: 'ready.ack'; agent: AgentInfo }
  | PushSubscribeAction
  | PushUnsubscribeAction
  | PushTestAction

export type ClaraActionType = ClaraAction['type']
