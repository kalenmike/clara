import type { AgentInfo } from './protocol.ts'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

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

export type ClaraActionType = ClaraAction['type']
