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
}

/** Every control is available, matching the hub-served panel. */
export const DEFAULT_PANEL_CAPABILITIES: PanelCapabilities = {
  hubControl: true,
  harnessControl: true,
  deviceControl: true,
  settingsControl: true,
}

export const PanelCapabilitiesContext = createContext<PanelCapabilities>(DEFAULT_PANEL_CAPABILITIES)

export function usePanelCapabilities(): PanelCapabilities {
  return useContext(PanelCapabilitiesContext)
}
