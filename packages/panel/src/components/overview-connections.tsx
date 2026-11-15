import type { PanelClientInfo, PanelDeviceInfo, PanelHarness } from '@clara/shared-types'
import { Button } from '@clara/ui/components/button'
import { Card, CardContent, CardHeader } from '@clara/ui/components/card'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, EmptyState } from './primitives.tsx'

const PREVIEW_ROWS = 5

/**
 * Compact overview previews of the full Clients and Harness tables. They keep
 * the four fields an operator scans for and link out to the complete views.
 */
export function ActiveClientsCard({
  clients,
  devices,
  now,
  onOpen,
}: {
  clients: PanelClientInfo[]
  devices: PanelDeviceInfo[]
  now: number
  onOpen: () => void
}) {
  const { masked } = usePeek()
  const deviceById = new Map(devices.map((device) => [device.id, device]))
  const pairing = clients.filter((client) => client.kind === 'enroll').length
  const active = clients.length - pairing
  const visible = clients.slice(0, PREVIEW_ROWS)

  return (
    <Card asChild>
      <section aria-labelledby="overview-clients-title">
        <CardHeader className="flex items-center justify-between gap-2">
          <div>
            <h2 id="overview-clients-title" className="text-sm font-semibold">
              Active clients
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Live end-to-end encrypted browser sessions
            </p>
          </div>
          <span className="flex items-center gap-2">
            <Badge tone={active > 0 ? 'info' : 'neutral'}>{active} active</Badge>
            {pairing > 0 ? <Badge tone="warning">{pairing} pairing</Badge> : null}
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={onOpen}>
              View all
            </Button>
          </span>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <EmptyState>No clients are connected right now.</EmptyState>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-1 py-2 font-medium">
                      Transport
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Paired device
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Connected
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((client) => {
                    const device = client.deviceId ? deviceById.get(client.deviceId) : undefined
                    const label =
                      device?.alias ??
                      client.deviceLabel ??
                      (client.deviceId ? 'Unknown device' : 'Unpaired client')
                    return (
                      <tr
                        key={`${client.transport}:${client.sid}`}
                        className="border-t border-border"
                      >
                        <td className="px-1 py-2">
                          <Badge tone={client.transport === 'local' ? 'info' : 'neutral'}>
                            {client.transport}
                          </Badge>
                        </td>
                        <td className="px-1 py-2">
                          {client.kind === 'enroll' ? (
                            <Badge tone="warning">Pairing</Badge>
                          ) : (
                            <>
                              <div className="font-medium">{label}</div>
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </section>
    </Card>
  )
}

export function ActiveAdaptersCard({
  clients,
  harnesses,
  now,
  onOpen,
}: {
  clients: PanelClientInfo[]
  harnesses: PanelHarness[]
  now: number
  onOpen: () => void
}) {
  const { masked } = usePeek()
  const harnessById = new Map(harnesses.map((harness) => [harness.harnessId, harness]))
  const visible = clients.slice(0, PREVIEW_ROWS)

  return (
    <Card asChild>
      <section aria-labelledby="overview-adapters-title">
        <CardHeader className="flex items-center justify-between gap-2">
          <div>
            <h2 id="overview-adapters-title" className="text-sm font-semibold">
              Active adapters
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Live end-to-end encrypted adapter sessions
            </p>
          </div>
          <span className="flex items-center gap-2">
            <Badge tone={clients.length > 0 ? 'info' : 'neutral'}>{clients.length} connected</Badge>
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={onOpen}>
              View all
            </Button>
          </span>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <EmptyState>No harness adapter is connected right now.</EmptyState>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-1 py-2 font-medium">
                      Transport
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Harness
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Connected
                    </th>
                    <th scope="col" className="px-1 py-2 font-medium">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((client) => {
                    const harness = client.harnessId ? harnessById.get(client.harnessId) : undefined
                    const identity = harness?.label ?? 'Unknown harness'
                    const identityId = harness?.harnessId ?? client.harnessId ?? client.adapterId
                    return (
                      <tr
                        key={`${client.transport}:${client.sid}`}
                        className="border-t border-border"
                      >
                        <td className="px-1 py-2">
                          <Badge tone={client.transport === 'local' ? 'info' : 'neutral'}>
                            {client.transport}
                          </Badge>
                        </td>
                        <td className="px-1 py-2">
                          <div className="font-medium">{identity}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {identityId ? (masked ? PEEK_MASK : shortId(identityId)) : '—'}
                          </div>
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </section>
    </Card>
  )
}
