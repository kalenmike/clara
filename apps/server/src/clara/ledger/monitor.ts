import type { AttentionKind, LedgerAlert } from '@clara/shared-types'
import type { PushNotificationPayload } from '../../push/payload.ts'
import type { PushService } from '../../push/service.ts'
import { sendDesktopAlert } from './desktop.ts'
import type { LedgerDeliveryStore } from './delivery.ts'
import type { LedgerReader } from './reader.ts'

export type LedgerAlertMonitorOptions = {
  reader: LedgerReader
  store: LedgerDeliveryStore
  push?: PushService
  enabled: () => boolean
  canPush?: () => boolean
  isDeskActive?: () => boolean
  hasClients?: () => boolean
  broadcast: (alert: LedgerAlert) => void
  intervalMs?: number
  log?: (message: string, detail?: unknown) => void
}

/**
 * Polls the ledger outbox and delivers each exception once. The plugin writes
 * the outbox; this monitor owns delivery cursors, push, and local alerts.
 */
export class LedgerAlertMonitor {
  private readonly options: LedgerAlertMonitorOptions
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = true

  constructor(options: LedgerAlertMonitorOptions) {
    this.options = options
    this.intervalMs = options.intervalMs ?? 15_000
  }

  start(options: { prime?: boolean } = {}): void {
    if (!this.options.enabled()) return
    if (options.prime || this.options.store.cursor() === undefined) {
      this.prime()
    }
    if (!this.stopped) return
    this.stopped = false
    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs)
    this.timer.unref?.()
    this.options.log?.('ledger alert monitor started')
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.options.log?.('ledger alert monitor stopped')
  }

  async runOnce(): Promise<void> {
    if (this.stopped || this.running || !this.options.enabled()) return
    this.running = true
    try {
      const cursor = this.options.store.cursor() ?? this.options.reader.latestId()
      const rows = this.options.reader.newAfter(cursor, 100)
      if (!rows.length) return

      for (const row of rows) {
        const alert = row.alert
        if (!this.options.store.delivered(alert.key)) {
          this.options.broadcast(alert)
          await this.push(alert)
          if (this.options.hasClients?.() === false) {
            await sendDesktopAlert(alert).catch((cause) => {
              this.options.log?.('desktop ledger alert failed', cause)
            })
          }
          this.options.store.markDelivered(alert.key)
          this.options.log?.(`ledger alert: ${alert.title}`)
        }
        this.options.store.setCursor(row.id)
      }
      this.options.store.prune()
    } catch (cause) {
      this.options.log?.('ledger alert monitor failed', cause)
    } finally {
      this.running = false
    }
  }

  private prime(): void {
    const latest = this.options.reader.latestId()
    this.options.store.setCursor(latest)
    const inbox = this.options.reader.inbox(100)
    if (inbox.items.length) {
      void this.summary(inbox.items.length)
    }
  }

  private async summary(count: number): Promise<void> {
    if (!this.options.push || !this.canPush()) return
    const payload: PushNotificationPayload = {
      v: 1,
      kind: 'question',
      sessionID: 'clara:summary',
      title: 'Clara needs you',
      body: `${count} item${count === 1 ? '' : 's'} need your attention. Open Clara to review.`,
      url: '/clara',
      tag: 'clara:alert:summary',
    }
    await this.options.push
      .notify(payload, { skipMobile: this.options.isDeskActive?.() === true })
      .catch((cause) => this.options.log?.('ledger alert summary push failed', cause))
  }

  private async push(alert: LedgerAlert): Promise<void> {
    if (!this.options.push || !this.canPush()) return
    const kind: AttentionKind = alert.kind === 'kill' ? 'error' : 'question'
    const payload: PushNotificationPayload = {
      v: 1,
      kind,
      sessionID: `clara:${alert.key}`,
      title: kind === 'error' ? 'Clara stopped a feature' : 'Clara needs you',
      body: `${alert.title}: ${clip(alert.body)}`,
      url: '/clara',
      tag: `clara:alert:${alert.key}`,
    }
    await this.options.push
      .notify(payload, { skipMobile: this.options.isDeskActive?.() === true })
      .catch((cause) => this.options.log?.('ledger alert push failed', cause))
  }

  private canPush(): boolean {
    return this.options.canPush?.() ?? Boolean(this.options.push)
  }
}

function clip(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}
