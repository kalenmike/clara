import type { PanelRelayDeployment } from '@clara/shared-types'
import type { RelayConfig, ServerConfig } from '../../config.ts'
import { saveRelayTarget, validateRelayConfig } from '../../config.ts'
import type { SecretKeyInfo } from '../../store/secret-key.ts'
import type { SettingsStore } from '../../store/settings.ts'
import { loadRelayArtifact } from './artifact.ts'
import { CloudflareClient } from './cloudflare-client.ts'
import { deployRelay } from './deploy.ts'
import {
  forgetCloudflareToken,
  hasCloudflareToken,
  loadCloudflareToken,
  loadRelayCredentials,
  loadRelayDeployment,
  saveCloudflareToken,
  saveRelayCredentials,
  saveRelayDeployment,
  type RelayDeploymentRecord,
} from './storage.ts'

export type DeploymentRuntime = {
  applyRelayConfig: (relay?: RelayConfig) => void
}

export type DeployInput = {
  token?: string
  accountId: string
  scriptName?: string
  rememberToken?: boolean
}

export type DeployOutcome = {
  deployment: PanelRelayDeployment
  warning?: string
}

export class CloudflareDeploymentState {
  readonly config: ServerConfig
  private readonly secretKey: SecretKeyInfo
  private readonly log: (message: string, detail?: unknown) => void
  private deployment: RelayDeploymentRecord | undefined
  private tokenStored: boolean
  private runtime: { controller: DeploymentRuntime; settings: SettingsStore } | undefined
  private deploying = false

  constructor(options: {
    config: ServerConfig
    secretKey: SecretKeyInfo
    log: (message: string, detail?: unknown) => void
  }) {
    this.config = options.config
    this.secretKey = options.secretKey
    this.log = options.log
    this.deployment = loadRelayDeployment(this.config.configDir)
    this.tokenStored = hasCloudflareToken(this.config.configDir)
  }

  storedToken(): Promise<string | undefined> {
    return loadCloudflareToken(this.config.configDir, this.secretKey)
  }

  attachRuntime(runtime: { controller: DeploymentRuntime; settings: SettingsStore }): void {
    this.runtime = runtime
  }

  async applyStoredRelay(): Promise<void> {
    const stored = await loadRelayCredentials(this.config.configDir, this.secretKey)
    if (!stored || this.isEnvManaged) return

    if (!this.config.relay) {
      this.config.relay = stored
      this.config.sources.relayUrl = 'file'
      this.config.sources.relayRoom = 'file'
      this.config.sources.agentToken = 'file'
      this.config.sources.clientToken = 'file'
      return
    }

    if (this.config.relay.url !== stored.url) return
    if (!this.config.relay.agentToken) {
      this.config.relay.agentToken = stored.agentToken
      this.config.sources.agentToken = 'file'
    }
    if (!this.config.relay.clientToken) {
      this.config.relay.clientToken = stored.clientToken
      this.config.sources.clientToken = 'file'
    }
  }

  get isEnvManaged(): boolean {
    return (
      this.config.sources.relayUrl === 'env' ||
      this.config.sources.relayRoom === 'env' ||
      this.config.sources.agentToken === 'env' ||
      this.config.sources.clientToken === 'env'
    )
  }

  get hasManualRelay(): boolean {
    return Boolean(this.config.relay) && !this.deployment && !this.isEnvManaged
  }

  snapshot(): PanelRelayDeployment {
    const hostname = this.deployment?.hostname
    const connected = Boolean(
      this.deployment &&
      this.config.relay &&
      hostname &&
      this.config.relay.url === `wss://${hostname}`
    )
    return {
      available: true,
      managed: Boolean(this.deployment),
      envManaged: this.isEnvManaged,
      connected,
      tokenStored: this.tokenStored,
      ...(this.deployment
        ? {
            accountId: this.deployment.accountId,
            scriptName: this.deployment.scriptName,
            hostname: this.deployment.hostname,
            deployedAt: this.deployment.deployedAt,
            reachable: this.deployment.reachable,
            ...(this.deployment.accountName ? { accountName: this.deployment.accountName } : {}),
          }
        : {}),
    }
  }

  async deploy(input: DeployInput): Promise<DeployOutcome> {
    if (this.deploying) throw new Error('deploy_in_progress')
    this.deploying = true
    try {
      const token =
        input.token?.trim() || (await loadCloudflareToken(this.config.configDir, this.secretKey))
      if (!token) throw new Error('token_required')
      if (this.isEnvManaged) throw new Error('env_managed')
      if (this.hasManualRelay) throw new Error('manual_relay')

      const artifact = loadRelayArtifact()
      const client = new CloudflareClient(token)
      const account = { id: input.accountId, name: input.accountId }
      try {
        const accounts = await client.listAccounts()
        const match = accounts.find((item) => item.id === input.accountId)
        if (match) account.name = match.name
      } catch {
        // Listing accounts needs an extra read permission. Deploying only needs
        // the account ID and Workers Scripts: Edit.
      }

      const current = this.config.relay
      const result = await deployRelay({
        client,
        artifact,
        account,
        scriptName: input.scriptName?.trim() || this.deployment?.scriptName || artifact.scriptName,
        room: current?.room,
        agentToken: current?.agentToken || undefined,
        clientToken: current?.clientToken || undefined,
      })

      const relay: RelayConfig = {
        url: result.url,
        room: result.room,
        agentToken: result.agentToken,
        clientToken: result.clientToken,
      }
      const record: RelayDeploymentRecord = {
        accountId: result.account.id,
        ...(result.account.name !== result.account.id ? { accountName: result.account.name } : {}),
        scriptName: result.scriptName,
        hostname: result.hostname,
        deployedAt: result.deployedAt,
        reachable: result.reachable,
      }

      await saveRelayCredentials(this.config.configDir, this.secretKey, relay)
      saveRelayTarget(this.config.configPath, { url: relay.url, room: relay.room })
      saveRelayDeployment(this.config.configDir, record)
      if (input.rememberToken === true) {
        await saveCloudflareToken(this.config.configDir, this.secretKey, token)
        this.tokenStored = true
      } else if (input.rememberToken === false) {
        forgetCloudflareToken(this.config.configDir)
        this.tokenStored = false
      }

      this.deployment = record
      this.config.relay = relay
      this.config.sources.relayUrl = 'file'
      this.config.sources.relayRoom = 'file'
      this.config.sources.agentToken = 'file'
      this.config.sources.clientToken = 'file'
      validateRelayConfig(this.config)

      if (this.runtime) {
        if (!this.runtime.settings.getFeature('relay')) {
          this.runtime.settings.setFeature('relay', true)
        }
        this.runtime.controller.applyRelayConfig(relay)
      }
      this.log(
        `relay deployed to Cloudflare (${result.hostname})${result.reachable ? '' : ' but health check failed'}`
      )
      if (!result.reachable) {
        this.log('cloudflare relay health check failed', result.healthError)
      }

      return {
        deployment: this.snapshot(),
        ...(result.reachable
          ? {}
          : {
              warning:
                result.healthError ??
                'The Worker deployed, but its health check has not answered yet.',
            }),
      }
    } finally {
      this.deploying = false
    }
  }

  forgetToken(): PanelRelayDeployment {
    forgetCloudflareToken(this.config.configDir)
    this.tokenStored = false
    return this.snapshot()
  }
}
