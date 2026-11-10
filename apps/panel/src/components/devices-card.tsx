import { useState } from 'react'
import { ShieldOff, Smartphone } from 'lucide-react'
import type { PanelDeviceInfo } from '@clara/shared-types'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { deletePanel } from '../lib/panel-api.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { Badge, CardBody, CollapsibleCard, EmptyState } from './primitives.tsx'

export function DevicesCard({
  devices,
  now,
  onChanged,
}: {
  devices: PanelDeviceInfo[]
  now: number
  onChanged: () => void
}) {
  const { masked } = usePeek()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const active = devices.filter((device) => !device.revokedAt)
  const revoked = devices.filter((device) => device.revokedAt)

  const revoke = async (device: PanelDeviceInfo) => {
    if (
      !window.confirm(
        `Revoke ${device.label}? Its key is deleted and live sessions are disconnected.`
      )
    ) {
      return
    }
    setPending(device.id)
    setError(undefined)
    try {
      await deletePanel(`/panel/api/v1/devices/${encodeURIComponent(device.id)}`)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  return (
    <CollapsibleCard
      title="Paired devices"
      description="Devices enrolled with their own revocable key"
      icon={<Smartphone className="size-4" aria-hidden="true" />}
      action={<Badge tone={active.length > 0 ? 'info' : 'neutral'}>{active.length} active</Badge>}
      defaultExpanded
    >
      <CardBody>
        {devices.length === 0 ? (
          <EmptyState>
            No devices are paired. Run <code className="font-mono">pnpm clara pair</code> to create
            a one-time enrollment link.
          </EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <th scope="col" className="px-1 py-2 font-medium">
                    Device
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Fingerprint
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Added
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    Last seen
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-medium">
                    Live
                  </th>
                  <th scope="col" className="px-1 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...active, ...revoked].map((device) => (
                  <tr
                    key={device.id}
                    className={`border-t border-neutral-100 dark:border-neutral-800 ${
                      device.revokedAt ? 'text-neutral-400 dark:text-neutral-500' : ''
                    }`}
                  >
                    <td className="px-1 py-2">
                      <div className="font-medium">{device.label}</div>
                      <div className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                        {masked ? PEEK_MASK : shortId(device.id)}
                      </div>
                    </td>
                    <td className="px-1 py-2 font-mono">
                      {masked ? PEEK_MASK : device.fingerprint}
                    </td>
                    <td
                      className="px-1 py-2 text-neutral-600 dark:text-neutral-300"
                      title={formatTimestamp(device.createdAt)}
                    >
                      {formatRelative(device.createdAt, now)}
                    </td>
                    <td
                      className="px-1 py-2 text-neutral-600 dark:text-neutral-300"
                      title={device.lastSeenAt ? formatTimestamp(device.lastSeenAt) : undefined}
                    >
                      {device.lastSeenAt ? formatRelative(device.lastSeenAt, now) : 'Never'}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      {device.revokedAt ? (
                        <Badge tone="neutral">Revoked</Badge>
                      ) : device.liveSessions > 1 ? (
                        <Badge tone="warning">{device.liveSessions}</Badge>
                      ) : (
                        device.liveSessions
                      )}
                    </td>
                    <td className="px-1 py-2 text-right">
                      {device.revokedAt ? (
                        <span className="text-[10px] uppercase tracking-wide">Revoked</span>
                      ) : (
                        <button
                          type="button"
                          disabled={pending === device.id}
                          onClick={() => void revoke(device)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50"
                        >
                          <ShieldOff className="size-3" aria-hidden="true" />
                          {pending === device.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error ? (
          <p className="pt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Each device has its own key. Revoking one does not affect the others. Multiple live
          sessions on one device are usually tabs of the same browser.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
