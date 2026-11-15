import {
  buildAdapterInstallLink,
  type PanelInstallInfo,
  type PanelInstallManifest,
} from '@clara/shared-types'
import type { ServerConfig } from '../config.ts'
import { PanelControlError } from './controls.ts'
import { InstallRegistry, type ResolvedInstallManifest } from './install-registry.ts'

export type InstallServiceOptions = {
  config: ServerConfig
  registry: InstallRegistry
  isEnabled: () => boolean
  log: (message: string, detail?: unknown) => void
}

/**
 * Issues adapter install offers. The hub reads the registry and builds the
 * one-line command, but the machine that runs the harness executes it. A
 * browser-only person copies the command; the desktop client runs it.
 */
export class InstallService {
  private readonly options: InstallServiceOptions
  private readonly registry: InstallRegistry

  constructor(options: InstallServiceOptions) {
    this.options = options
    this.registry = options.registry
  }

  async info(force = false): Promise<PanelInstallInfo> {
    const enabled = this.options.isEnabled()
    const registry = await this.registry.info(force)
    if (enabled) return { enabled, available: true, registry }
    return {
      enabled,
      available: false,
      reason:
        'Adapter setup is off. Turn it on in Settings → Adapter downloads to share install commands.',
      registry,
    }
  }

  async manifest(kind: string, force = false): Promise<ResolvedInstallManifest> {
    if (!this.options.isEnabled()) {
      throw new PanelControlError(
        403,
        'install_disabled',
        'Adapter setup is off. Turn it on in Settings → Adapter downloads.'
      )
    }
    return this.registry.resolved(kind, force)
  }

  /** The one-line command a browser or terminal user can run. */
  command(manifest: PanelInstallManifest, code: string): string {
    const noRunner = manifest.harness === 'opencode' ? ' --no-runner' : ''
    return `curl -fsSL ${manifest.install} | sh -s -- --pair ${code}${noRunner}`
  }

  deepLink(code: string, kind?: string): string {
    return buildAdapterInstallLink(code, kind)
  }

  baseUrl(): string {
    return this.options.config.adapterRegistryUrl
  }

  /** No background work to stop; kept for the hub lifecycle. */
  close(): void {}
}
