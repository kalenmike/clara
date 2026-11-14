import type {
  PanelClientInfo,
  PanelDeviceInfo,
  PanelSnapshot,
  PanelTransport,
} from '@clara/shared-types'

export type BrowserPairingConnection = {
  client?: PanelClientInfo
  device?: PanelDeviceInfo
  label?: string
}

/**
 * A browser pairing is done when a live device session appears after the code
 * was issued, or when a device record is created after it. Enrollment sessions
 * close before the browser reconnects with its device key, so they are not a
 * success signal.
 */
export function findBrowserPairingConnection(
  issuedAt: number,
  transport: PanelTransport,
  snapshot: Pick<PanelSnapshot, 'clients' | 'devices'>
): BrowserPairingConnection | undefined {
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return undefined

  const devices = new Map(snapshot.devices.map((device) => [device.id, device]))

  for (const client of snapshot.clients) {
    if (client.kind !== 'device' || client.transport !== transport) continue
    if (Date.parse(client.connectedAt) < issuedAt) continue
    const device = client.deviceId ? devices.get(client.deviceId) : undefined
    return connection(client, device)
  }

  for (const device of snapshot.devices) {
    if (device.revokedAt !== undefined) continue
    if (device.transport !== undefined && device.transport !== transport) continue
    const createdAt = Date.parse(device.createdAt)
    if (createdAt >= issuedAt) return connection(undefined, device)
  }

  return undefined
}

function connection(
  client: PanelClientInfo | undefined,
  device: PanelDeviceInfo | undefined
): BrowserPairingConnection {
  const label = client?.deviceLabel ?? device?.alias ?? device?.label
  return {
    ...(client ? { client } : {}),
    ...(device ? { device } : {}),
    ...(label ? { label } : {}),
  }
}
