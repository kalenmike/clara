import { createContext, useContext } from 'react'

/**
 * Control areas a panel host may disable. The hub-served panel allows every
 * control; a remote host can switch off the ones that would cut its own
 * connection.
 */
export type PanelCapabilities = {
  /** Controls that take the hub or its external connections offline. */
  hubControl: boolean
  /** Harness pairing, probing, and adapter removal. */
  harnessControl: boolean
  /** Browser pairing, device aliases, revocation, and purging. */
  deviceControl: boolean
  /** Feature switches, transports, relay, orchestration, sync, and config edits. */
  settingsControl: boolean
  /** The panel's own Light/Dark/System switch. */
  allowThemeSwitch: boolean
  /** The Go offline / Go online control. */
  allowGoOffline: boolean
  /** The local transport switch. */
  allowLocalToggle: boolean
  /** The relay transport switch. */
  allowRelayToggle: boolean
  /** The relay URL, token, and room editor. */
  allowRelayTargetEdit: boolean
}

/** Every control is available, matching the hub-served panel. */
export const DEFAULT_PANEL_CAPABILITIES: PanelCapabilities = {
  hubControl: true,
  harnessControl: true,
  deviceControl: true,
  settingsControl: true,
  allowThemeSwitch: true,
  allowGoOffline: true,
  allowLocalToggle: true,
  allowRelayToggle: true,
  allowRelayTargetEdit: true,
}

export const PanelCapabilitiesContext = createContext<PanelCapabilities>(DEFAULT_PANEL_CAPABILITIES)

/** Why the bundled panel cannot take its own connection offline. */
export const GO_OFFLINE_UNAVAILABLE_REASON =
  "Transport changes belong in the hub's server panel. This panel cannot take its own connection offline."

/** Why the switch for the transport carrying this panel is unavailable. */
export const LOCAL_TRANSPORT_LOCK_REASON =
  "The local transport carries this panel's connection, so it can only be changed in the hub's server panel."

export const RELAY_TRANSPORT_LOCK_REASON =
  "The relay carries this panel's connection, so it can only be changed in the hub's server panel."

/** Why the relay URL, token, and room are read-only here. */
export const RELAY_TARGET_LOCK_REASON =
  "The relay target carries this panel's connection, so its URL, token, and room can only be changed in the hub's server panel."

export function usePanelCapabilities(): PanelCapabilities {
  return useContext(PanelCapabilitiesContext)
}
