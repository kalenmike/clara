import type { PanelCapabilities } from '@clara/panel'

/** The transport that carries a browser connection to the hub. */
export type HubPanelTransport = 'local' | 'relay'

/**
 * A `local` room uses the hub's loopback listener; every other room is a relay
 * room. Either way the panel reaches the hub over the connection it is riding,
 * so the route must never assume a direct loopback URL.
 */
export function hubPanelTransport(room: string | undefined): HubPanelTransport {
  return room === 'local' ? 'local' : 'relay'
}

/**
 * Controls the bundled panel must not use. Going offline would close its own
 * connection, the switch for the transport in use would do the same, and a relay
 * edit would retarget the connection carrying the panel. The server-served panel
 * on the hub keeps every control because its defaults stay true.
 */
export function hubPanelCapabilities(transport: HubPanelTransport): Partial<PanelCapabilities> {
  return {
    allowGoOffline: false,
    allowLocalToggle: transport !== 'local',
    allowRelayToggle: transport !== 'relay',
    allowRelayTargetEdit: transport !== 'relay',
  }
}
