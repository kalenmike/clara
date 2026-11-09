// One serialized delivery cycle from the orchestrator into the origin session.
//
// The adapter polls on a fixed interval while a queued prompt can take longer
// than that interval. Without serialization two cycles both see a finished root
// run as undelivered and queue the same terminal message. The run and its
// alerts are also reserved before the awaited prompt so a concurrent or
// interrupted cycle cannot re-send them, and rolled back if the prompt fails so
// a transient error never suppresses a completion notification.

import {
  planDeliveries,
  reserveDelivery,
  type DeliveryAlert,
  type DeliveryMessage,
  type DeliveryRun,
  type DeliveryState,
} from './delivery.ts'

export interface DeliveryCycleInput {
  load: () => Promise<{ runs: DeliveryRun[]; alerts: DeliveryAlert[] }>
  usableOrigin: (sessionID: string) => Promise<boolean>
  deliver: (message: DeliveryMessage) => Promise<void>
  state: DeliveryState
  persist: () => void
  interfaceAgent?: string
  onError?: (message: string) => void
}

export function createDeliveryCycle(input: DeliveryCycleInput): () => Promise<void> {
  let running = false
  const report = (error: unknown): void => {
    const text = error instanceof Error ? error.message : String(error)
    if (input.onError) input.onError(text)
    else console.error(`[clara-policy] delivery to the origin session failed: ${text}`)
  }
  return async () => {
    if (running) return
    running = true
    try {
      const { runs, alerts } = await input.load()
      const messages = planDeliveries({
        runs,
        alerts,
        deliveredAlerts: input.state.alerts,
        deliveredRuns: input.state.runs,
        interfaceAgent: input.interfaceAgent,
      })
      for (const message of messages) {
        if (!(await input.usableOrigin(message.sessionID))) continue
        const rollback = reserveDelivery(input.state, message)
        input.persist()
        try {
          await input.deliver(message)
        } catch (error) {
          rollback()
          input.persist()
          report(error)
        }
      }
    } catch {
      // The service may be restarting.
    } finally {
      running = false
    }
  }
}
