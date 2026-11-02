import type { LedgerAlert, LedgerInbox } from '@clara/shared-types'
import type { RelayTransport } from '@/lib/transport/relay'

export type LedgerInboxResult =
  | { type: 'inbox'; inbox: LedgerInbox }
  | { type: 'error'; code: 'disabled' | 'unavailable'; message: string }

export type ClaraControl = {
  subscribeLedgerAlert: (listener: (alert: LedgerAlert) => void) => () => void
  requestLedgerInbox: (id: string) => Promise<LedgerInboxResult>
}

export function createClaraControl(
  _transport: Pick<RelayTransport, 'addChannel' | 'sendAction'>
): ClaraControl {
  throw new Error('Clara management is not included in this build')
}
