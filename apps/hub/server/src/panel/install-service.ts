import {
  buildAdapterInstallLink,
  type PanelInstallInfo,
  type PanelInstallManifest,
} from '@clara/shared-types'
import { quoteShellArgument } from '@clara/adapter-install'
import type { ServerConfig } from '../config.ts'
import { PanelControlError } from './controls.ts'
import { InstallRegistry, type ResolvedInstallManifest } from './install-registry.ts'

export type InstallServiceOptions = {
  config: ServerConfig
  registry: InstallRegistry
  isEnabled: () => boolean
  /** The adapter version a paired connection reports for this kind. */
  installedVersion?: (kind: string) => string | undefined
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
    const installed = this.options.installedVersion
    // An adapter can be paired and connected without ever calling the registry,
    // so this is the only place the panel learns the installed version.
    const entries = installed
      ? registry.entries.map((entry) => {
          const version = installed(entry.kind)
          return version ? { ...entry, installedVersion: version } : entry
        })
      : registry.entries
    const info = { ...registry, entries }
    if (enabled) return { enabled, available: true, registry: info }
    return {
      enabled,
      available: false,
      reason:
        'Adapter setup is off. Turn it on in Settings → Adapter downloads to share install commands.',
      registry: info,
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
  command(manifest: PanelInstallManifest, code: string, opencodeUrl?: string): string {
    const noRunner = manifest.harness === 'opencode' ? ' --no-runner' : ''
    const harnessUrl = opencodeUrl
      ? ` ${quoteShellArgument('--opencode-url')} ${quoteShellArgument(opencodeUrl)}`
      : ''
    return `curl -fsSL ${manifest.install} | sh -s -- --pair ${code}${noRunner}${harnessUrl}`
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
