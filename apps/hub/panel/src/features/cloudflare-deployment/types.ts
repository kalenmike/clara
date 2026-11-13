import type {
  PanelCloudflareAccount,
  PanelRelayDeployment,
  PanelRelayTransport,
} from '@clara/shared-types'

export type CloudflareRelaySlotProps = {
  relay: PanelRelayTransport
  now: number
  onChanged: () => void
}

export type CloudflareAccountsResponse = {
  accounts: PanelCloudflareAccount[]
}

export type CloudflareDeployResponse = {
  deployment: PanelRelayDeployment
  warning?: string
}
