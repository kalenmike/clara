import type { ClaraAction } from './actions.ts'
import type { AgentInfo } from './protocol.ts'
import type { LedgerAlert, LedgerInbox } from './clara/ledger.ts'

export type SyncEntry = {
  key: string
  value: string | null
  updatedAt: number
}

export type SyncSnapshot = {
  namespace: string
  revision: number
  entries: SyncEntry[]
}

export type SyncErrorCode = 'invalid' | 'too_large' | 'conflict' | 'disabled' | 'storage'

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
  | {
      type: 'push.status'
      id?: string
      subscribed: boolean
      endpoint?: string
      count?: number
      tested?: boolean
      error?: string
    }
  | {
      type: 'sync.revision'
      id: string
      namespace: string
      revision: number
    }
  | {
      type: 'sync.snapshot'
      id: string
      namespace: string
      revision: number
      entries: SyncEntry[]
    }
  | {
      type: 'sync.error'
      id: string
      namespace?: string
      code: SyncErrorCode
      message: string
      revision?: number
      entries?: SyncEntry[]
    }
  | {
      type: 'ledger.alert'
      alert: LedgerAlert
    }
  | {
      type: 'ledger.inbox'
      id: string
      inbox: LedgerInbox
    }
  | {
      type: 'ledger.error'
      id: string
      code: 'disabled' | 'unavailable'
      message: string
    }

export type ClaraStateType = ClaraState['type']

export type ClaraPayload = ClaraAction | ClaraState
