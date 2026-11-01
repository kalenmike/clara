import { Users } from 'lucide-react'
import type { PanelClientInfo } from '@clara/shared-types'
import { formatDuration, formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { Badge, Card, CardBody, CardHeader, EmptyState } from './primitives.tsx'

export function ClientsTable({ clients, now }: { clients: PanelClientInfo[]; now: number }) {
  return (
    <Card>
      <CardHeader
        title="Connected clients"
        description="Live end-to-end encrypted sessions"
        icon={<Users className="size-4" aria-hidden="true" />}
        action={
          <Badge tone={clients.length > 0 ? 'info' : 'neutral'}>{clients.length} active</Badge>
        }
      />
      <CardBody>
        {clients.length === 0 ? (
          <EmptyState>No paired clients are connected right now.</EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Transport
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Session
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Device
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
                    Requests
                  </th>
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
                    <td className="px-1 py-2 font-mono" title={client.sid}>
                      {shortId(client.sid)}
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
          Session IDs are random per connection and do not reveal the pairing key.
        </p>
      </CardBody>
    </Card>
  )
}
