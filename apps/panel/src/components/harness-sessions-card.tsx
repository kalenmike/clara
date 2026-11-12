import { Cable } from 'lucide-react'
import type { PanelClientInfo, PanelHarness } from '@clara/shared-types'
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

export function HarnessSessionsCard({
  clients,
  harnesses,
  now,
}: {
  clients: PanelClientInfo[]
  harnesses: PanelHarness[]
  now: number
}) {
  const { masked } = usePeek()
  const withTraffic = clients.some((client) => client.bytesIn !== undefined)
  const harnessById = new Map(harnesses.map((harness) => [harness.harnessId, harness]))
  const harnessFor = (client: PanelClientInfo) =>
    client.harnessId ? harnessById.get(client.harnessId) : undefined

  return (
    <CollapsibleCard
      title="Connected adapters"
      description="Live end-to-end encrypted harness adapter sessions"
      icon={<Cable className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={clients.length > 0 ? 'info' : 'neutral'}>{clients.length} connected</Badge>
      }
      defaultExpanded
    >
      <CardBody>
        {clients.length === 0 ? (
          <EmptyState>No harness adapter is connected right now.</EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Transport
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Session
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Harness
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Fingerprint
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
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const harness = harnessFor(client)
                  const identity = harness?.label ?? 'Unknown harness'
                  const identityId = harness?.harnessId ?? client.harnessId ?? client.adapterId
                  return (
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
                        title={
                          masked
                            ? undefined
                            : [client.harnessId, client.adapterId].filter(Boolean).join(' · ')
                        }
                      >
                        <div className="font-medium">{identity}</div>
                        <div className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                          {identityId ? (masked ? PEEK_MASK : shortId(identityId)) : '—'}
                        </div>
                      </td>
                      <td className="px-1 py-2 font-mono">{harness?.kind ?? '—'}</td>
                      <td
                        className="px-1 py-2 font-mono"
                        title={masked ? undefined : harness?.fingerprint}
                      >
                        {harness?.fingerprint ? (masked ? PEEK_MASK : harness.fingerprint) : '—'}
                      </td>
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Adapter sessions use the same encrypted transport as a browser client. They appear here
          instead of Clients because they have no device identity. The fingerprint matches the
          paired harness credential.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
