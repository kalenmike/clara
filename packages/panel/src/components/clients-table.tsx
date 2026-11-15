import { Users } from 'lucide-react'
import type { PanelClientInfo, PanelDeviceInfo } from '@clara/shared-types'
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTimestamp,
  shortId,
} from '../lib/format.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, EmptyState } from './primitives.tsx'

export function ClientsTable({
  clients,
  devices,
  now,
}: {
  clients: PanelClientInfo[]
  devices: PanelDeviceInfo[]
  now: number
}) {
  const { masked } = usePeek()
  const withTraffic = clients.some((client) => client.bytesIn !== undefined)
  const pairing = clients.filter((client) => client.kind === 'enroll').length
  const active = clients.length - pairing
  const deviceById = new Map(devices.map((device) => [device.id, device]))
  const deviceFor = (client: PanelClientInfo) =>
    client.deviceId ? deviceById.get(client.deviceId) : undefined
  const fingerprintFor = (client: PanelClientInfo) => {
    const fingerprint = deviceFor(client)?.fingerprint
    if (!fingerprint) return '—'
    return masked ? PEEK_MASK : fingerprint
  }

  return (
    <CollapsibleCard
      title="Connected clients"
      description="Live end-to-end encrypted browser sessions linked to paired devices"
      icon={<Users className="size-4" aria-hidden="true" />}
      action={
        <span className="inline-flex items-center gap-1">
          <Badge tone={active > 0 ? 'info' : 'neutral'}>{active} active</Badge>
          {pairing > 0 ? <Badge tone="warning">{pairing} pairing</Badge> : null}
        </span>
      }
      defaultExpanded
    >
      <CardBody>
        {clients.length === 0 ? (
          <EmptyState>No paired clients are connected right now.</EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Transport
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Session
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Paired device
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Fingerprint
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Device class
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Connected
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Last seen
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Idle
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-medium">
                    In flight
                  </th>
                  {withTraffic ? (
                    <>
                      <th scope="col" className="px-1 py-2 text-right font-medium">
                        Requests
                      </th>
                      <th scope="col" className="px-1 py-2 text-right font-medium">
                        In
                      </th>
                      <th scope="col" className="px-1 py-2 text-right font-medium">
                        Out
                      </th>
                    </>
                  ) : null}
                  <th scope="col" className="px-1 py-2 font-medium">
                    Desk hold
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={`${client.transport}:${client.sid}`} className="border-t border-border">
                    <td className="px-1 py-2">
                      <Badge tone={client.transport === 'local' ? 'info' : 'neutral'}>
                        {client.transport}
                      </Badge>
                    </td>
                    <td className="px-1 py-2 font-mono" title={masked ? undefined : client.sid}>
                      {masked ? PEEK_MASK : shortId(client.sid)}
                    </td>
                    <td
                      className="px-1 py-2"
                      title={
                        client.kind === 'enroll'
                          ? 'Pairing session'
                          : masked
                            ? undefined
                            : (client.deviceId ?? 'Not enrolled')
                      }
                    >
                      {client.kind === 'enroll' ? (
                        <Badge tone="warning">Pairing</Badge>
                      ) : (
                        <>
                          <div className="font-medium">
                            {deviceFor(client)?.alias ??
                              client.deviceLabel ??
                              (client.deviceId ? 'Unknown device' : 'Unpaired client')}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {client.deviceId
                              ? masked
                                ? PEEK_MASK
                                : shortId(client.deviceId)
                              : '—'}
                          </div>
                        </>
                      )}
                    </td>
                    <td
                      className="px-1 py-2 font-mono"
                      title={masked ? undefined : deviceFor(client)?.fingerprint}
                    >
                      {fingerprintFor(client)}
                    </td>
                    <td className="px-1 py-2 capitalize">
                      {client.kind === 'enroll' ? '—' : (client.deviceClass ?? 'Unknown')}
                    </td>
                    <td
                      className="px-1 py-2 text-foreground"
                      title={formatTimestamp(client.connectedAt)}
                    >
                      {formatRelative(client.connectedAt, now)}
                    </td>
                    <td
                      className="px-1 py-2 text-foreground"
                      title={formatTimestamp(client.lastSeenAt)}
                    >
                      {formatRelative(client.lastSeenAt, now)}
                    </td>
                    <td className="px-1 py-2 text-foreground">{formatDuration(client.idleMs)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{client.requests}</td>
                    {withTraffic ? (
                      <>
                        <td className="px-1 py-2 text-right tabular-nums">
                          {client.requestsTotal ?? '—'}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">
                          {client.bytesIn === undefined ? '—' : formatBytes(client.bytesIn)}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">
                          {client.bytesOut === undefined ? '—' : formatBytes(client.bytesOut)}
                        </td>
                      </>
                    ) : null}
                    <td className="px-1 py-2">
                      {client.holdPhone ? <Badge tone="warning">Held</Badge> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Session IDs are random per connection. A pairing session closes once enrollment completes;
          it carries no device until then. For paired devices, compare the short device id or
          fingerprint with Paired devices when labels match; the fingerprint identifies the key
          without revealing it. Harness adapter sessions are listed under Harness. Traffic counters
          are omitted while monitoring is off.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
