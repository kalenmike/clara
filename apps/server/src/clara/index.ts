import type { LedgerAlert, LedgerInbox } from '@clara/shared-types'
import type { OpenCodeClient } from '../opencode.ts'
import type { PushService } from '../push/service.ts'
import type { ClaraDatabase } from '../store/database.ts'
import type { SettingsStore } from '../store/settings.ts'
import { syncClaraAgentVisibility, type ClaraAgentSyncResult } from './agents.ts'
import { LedgerAlertMonitor } from './ledger/monitor.ts'
import { LedgerReader } from './ledger/reader.ts'
import { LedgerAlertStore } from './ledger/store.ts'

export type ClaraManagementOptions = {
  config: { ledgerDbPath: string }
  database: ClaraDatabase
  settings: SettingsStore
  openCode: OpenCodeClient
  push?: PushService
  broadcast: (alert: LedgerAlert) => void
  canPush: () => boolean
  isDeskActive: () => boolean
  hasClients: () => boolean
  canProxy: () => boolean
  /** Test seam; the panel uses the real installer manifest by default. */
  syncAgents?: (enabled: boolean) => ClaraAgentSyncResult
  log: (message: string, detail?: unknown) => void
}

/**
 * The single entry point for Clara management in the home agent. Everything
 * ledger-specific lives behind this facade: core code only decides when to
 * start, stop, and ask for the inbox.
 */
export class ClaraManagement {
  private readonly options: ClaraManagementOptions
  private ledgerReader?: LedgerReader
  private deliveryStore?: LedgerAlertStore
  private alertMonitor?: LedgerAlertMonitor

  constructor(options: ClaraManagementOptions) {
    this.options = options
  }

  get ledgerPath(): string {
    return this.options.config.ledgerDbPath
  }

  /** Capability injected into the transport agents. */
  ledgerCapability(): {
    enabled: () => boolean
    inbox: () => LedgerInbox
  } {
    return {
      enabled: () => this.options.settings.getManagement(),
      inbox: () => this.reader().inbox(),
    }
  }

  /**
   * Keep the generated agent files aligned with the switch and reload
   * OpenCode only when a file changed or the switch itself moved. A reload
   * failure must never block the saved switch or the daemon.
   */
  async applyAgentVisibility(
    enabled: boolean,
    options: { forceReload?: boolean } = {}
  ): Promise<void> {
    const sync = this.options.syncAgents ?? syncClaraAgentVisibility
    let synced: ClaraAgentSyncResult | undefined
    try {
      synced = sync(enabled)
    } catch (cause) {
      this.options.log('could not sync the Clara agent files', cause)
      if (!options.forceReload) return
    }
    if (synced?.skipped.length) {
      this.options.log(
        'left edited Clara agent files untouched',
        synced.skipped.map((id) => `${id}.md`).join(', ')
      )
    }
    if (!this.options.canProxy()) return
    if (!synced?.updated.length && !options.forceReload) return

    try {
      await this.options.openCode.reload()
    } catch (cause) {
      this.options.log('could not reload OpenCode after changing Clara management', cause)
    }
  }

  startMonitor(options: { prime?: boolean } = {}): void {
    if (!this.options.settings.getManagement() || this.options.settings.getStopped()) return
    this.monitor().start(options)
  }

  stopMonitor(): void {
    this.alertMonitor?.stop()
  }

  close(): void {
    this.stopMonitor()
  }

  private reader(): LedgerReader {
    this.ledgerReader ??= new LedgerReader(this.options.config.ledgerDbPath, this.options.log)
    return this.ledgerReader
  }

  private store(): LedgerAlertStore {
    this.deliveryStore ??= new LedgerAlertStore(this.options.database)
    return this.deliveryStore
  }

  private monitor(): LedgerAlertMonitor {
    this.alertMonitor ??= new LedgerAlertMonitor({
      reader: this.reader(),
      store: this.store(),
      push: this.options.push,
      enabled: () =>
        this.options.settings.getManagement() && !this.options.settings.getStopped(),
      canPush: this.options.canPush,
      isDeskActive: this.options.isDeskActive,
      hasClients: this.options.hasClients,
      broadcast: this.options.broadcast,
      log: this.options.log,
    })
    return this.alertMonitor
  }
}
