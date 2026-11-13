import type { RelayConfig, ServerConfig } from '../../config.ts'
import type { PanelFeature } from '../../panel/feature.ts'
import type { SecretKeyInfo } from '../../store/secret-key.ts'
import type { SettingsStore } from '../../store/settings.ts'

export type CreateCloudflareDeploymentOptions = {
  config: ServerConfig
  secretKey: SecretKeyInfo
  log: (message: string, detail?: unknown) => void
}

export type RelayRuntime = {
  applyRelayConfig: (relay?: RelayConfig) => void
}

export type CloudflareDeployment = {
  panel: PanelFeature
  /**
   * Merge the encrypted credentials written by a previous deployment into the
   * loaded config before the relay client is constructed.
   */
  applyStoredRelay: () => Promise<void>
  attachRuntime: (runtime: { controller: RelayRuntime; settings: SettingsStore }) => void
  close: () => void
}
