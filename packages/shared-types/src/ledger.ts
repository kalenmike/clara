// Clara ledger alerts.
//
// The plugin writes the outbox; the home agent reads it and delivers it. These
// types are the contract between the home agent and every browser client.

export const LEDGER_ALERT_KINDS = [
  'decision',
  'stalled',
  'budget',
  'approval',
  'gates',
  'kill',
] as const

export type LedgerAlertKind = (typeof LEDGER_ALERT_KINDS)[number]

export type LedgerAlert = {
  key: string
  kind: LedgerAlertKind
  featureId: number
  slug: string
  workspace: string
  title: string
  body: string
  createdAt: string
}

export type LedgerInbox = {
  items: LedgerAlert[]
  generatedAt: string
}
