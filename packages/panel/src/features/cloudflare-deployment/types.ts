import type {
  PanelCloudflareAccount,
  PanelCloudflareZone,
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

export type CloudflareZonesResponse = {
  zones: PanelCloudflareZone[]
}

export type CloudflareDeployResponse = {
  deployment: PanelRelayDeployment
  warning?: string
}
