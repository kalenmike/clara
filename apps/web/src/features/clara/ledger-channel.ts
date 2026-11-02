import type { ClaraAction, ClaraState, LedgerAlert, LedgerInbox } from '@clara/shared-types'
import type { RelayTransport } from '@/lib/transport/relay'

const LEDGER_TIMEOUT_MS = 15_000

export type LedgerInboxResult =
  | { type: 'inbox'; inbox: LedgerInbox }
  | { type: 'error'; code: 'disabled' | 'unavailable'; message: string }

export type ClaraControl = {
  subscribeLedgerAlert: (listener: (alert: LedgerAlert) => void) => () => void
  requestLedgerInbox: (id: string) => Promise<LedgerInboxResult>
}

type Pending = {
  resolve: (response: LedgerInboxResult) => void
  reject: (cause: unknown) => void
  timer: number
}

/** The relay transport's Clara extension: inbox reads and alert delivery. */
export function createClaraControl(
  transport: Pick<RelayTransport, 'addChannel' | 'sendAction'>
): ClaraControl {
  const pending = new Map<string, Pending>()
  const listeners = new Set<(alert: LedgerAlert) => void>()

  const settle = (id: string, result: LedgerInboxResult): void => {
    const entry = pending.get(id)
    if (!entry) return
    window.clearTimeout(entry.timer)
    pending.delete(id)
    entry.resolve(result)
  }

  transport.addChannel({
    handlePayload(payload: ClaraAction | ClaraState): boolean {
      if (payload.type === 'ledger.alert') {
        for (const listener of listeners) listener(payload.alert)
        return true
      }
      if (payload.type === 'ledger.error') {
        settle(payload.id, { type: 'error', code: payload.code, message: payload.message })
        return true
      }
      if (payload.type === 'ledger.inbox' && 'inbox' in payload) {
        settle(payload.id, { type: 'inbox', inbox: payload.inbox })
        return true
      }
      return false
    },
    close(cause: unknown) {
      for (const [id, entry] of pending) {
        window.clearTimeout(entry.timer)
        entry.reject(cause)
        pending.delete(id)
      }
    },
  })

  return {
    subscribeLedgerAlert(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async requestLedgerInbox(id) {
      if (pending.has(id)) throw new Error('A Clara inbox request is already in flight')

      const response = new Promise<LedgerInboxResult>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id)
          reject(new Error('Timed out waiting for the home server to read the Clara inbox'))
        }, LEDGER_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
      })

      try {
        await transport.sendAction({ type: 'ledger.inbox', id })
      } catch (cause) {
        const entry = pending.get(id)
        if (entry) {
          window.clearTimeout(entry.timer)
          pending.delete(id)
          entry.reject(cause)
        }
      }

      return response
    },
  }
}
