import { Users } from 'lucide-react'
import type { PanelClientInfo } from '@clara/shared-types'
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

export function ClientsTable({ clients, now }: { clients: PanelClientInfo[]; now: number }) {
  const withTraffic = clients.some((client) => client.bytesIn !== undefined)
  const { masked } = usePeek()

  return (
    <CollapsibleCard
      title="Connected clients"
      description="Live end-to-end encrypted sessions"
      icon={<Users className="size-4" aria-hidden="true" />}
      action={<Badge tone={clients.length > 0 ? 'info' : 'neutral'}>{clients.length} active</Badge>}
      defaultExpanded
    >
      <CardBody>
        {clients.length === 0 ? (
          <EmptyState>No paired clients are connected right now.</EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[1020px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
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
                  <tr
                    key={`${client.transport}:${client.sid}`}
                    className="border-t border-neutral-100 dark:border-neutral-800"
                  >
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
                      title={masked ? undefined : (client.deviceId ?? 'Not enrolled')}
                    >
                      {client.deviceLabel ??
                        (client.deviceId ? (masked ? PEEK_MASK : shortId(client.deviceId)) : '—')}
                    </td>
                    <td className="px-1 py-2 capitalize">{client.deviceClass ?? 'Unknown'}</td>
                    <td
                      className="px-1 py-2 text-neutral-600 dark:text-neutral-300"
                      title={formatTimestamp(client.connectedAt)}
                    >
                      {formatRelative(client.connectedAt, now)}
                    </td>
                    <td
                      className="px-1 py-2 text-neutral-600 dark:text-neutral-300"
                      title={formatTimestamp(client.lastSeenAt)}
                    >
                      {formatRelative(client.lastSeenAt, now)}
                    </td>
                    <td className="px-1 py-2 text-neutral-600 dark:text-neutral-300">
                      {formatDuration(client.idleMs)}
                    </td>
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
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Session IDs are random per connection. Paired devices keep a stable identity without
          revealing their device key. Traffic counters are omitted while monitoring is off.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
