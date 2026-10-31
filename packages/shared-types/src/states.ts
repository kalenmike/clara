import type { ClaraAction } from './actions.ts'
import type { AgentInfo } from './protocol.ts'

/**
 * States travel from the home agent to a browser client. Response chunks are
 * base64url encoded so a single JSON frame decoder works in every runtime.
 */
export type ClaraState =
  | {
      type: 'http.response'
      id: string
      status: number
      statusText: string
      headers: Record<string, string>
    }
  | { type: 'http.chunk'; id: string; data: string }
  | { type: 'http.end'; id: string }
  | { type: 'http.error'; id: string; message: string; code?: string }
  | { type: 'agent.status'; online: boolean; agent?: AgentInfo }

export type ClaraStateType = ClaraState['type']

export type ClaraPayload = ClaraAction | ClaraState
