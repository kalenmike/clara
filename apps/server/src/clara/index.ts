import {
  builtinCatalog,
  catalogPipelines,
  pipelineDir,
  type PipelineCatalog,
} from '@clara/pipelines'
import type { OpenCodeClient } from '../opencode.ts'
import type { SettingsStore } from '../store/settings.ts'
import { syncClaraAgentVisibility, type ClaraAgentSyncResult } from './agents.ts'

export type ClaraManagementOptions = {
  config: { ledgerDbPath: string }
  settings: SettingsStore
  openCode: OpenCodeClient
  canProxy: () => boolean
  /** Test seam; the panel uses the real installer manifest by default. */
  syncAgents?: (enabled: boolean) => ClaraAgentSyncResult
  log: (message: string, detail?: unknown) => void
}

/**
 * The single entry point for Clara management in the home agent. Alerts are
 * delivered by the ledger daemon as Clara sessions, so this facade only owns
 * the generated agent catalog and the worker-session notification filter.
 */
export class ClaraManagement {
  private readonly options: ClaraManagementOptions

  constructor(options: ClaraManagementOptions) {
    this.options = options
  }

  get ledgerPath(): string {
    return this.options.config.ledgerDbPath
  }

  /**
   * Read-only view of the effective pipeline catalog. The settings screen
   * keeps built-ins and custom files separate so an override is visible rather
   * than silently replacing the shipped preset.
   */
  pipelineCatalog(): PipelineCatalog {
    const builtins = builtinCatalog()
    const catalog = catalogPipelines()
    return {
      directory: pipelineDir(),
      builtins: builtins.pipelines.map((entry) => entry.pipeline),
      custom: catalog.pipelines.flatMap((entry) =>
        entry.source === 'file' && entry.path
          ? [{ pipeline: entry.pipeline, path: entry.path }]
          : []
      ),
      errors: catalog.errors,
    }
  }

  /** Generic session suppression supplied to the push monitor. */
  suppressSession = (session: { metadata?: Record<string, unknown> }): boolean =>
    this.options.settings.getManagement() && session.metadata?.automation === true

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
}
