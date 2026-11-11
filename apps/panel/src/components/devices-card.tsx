import { useState } from 'react'
import { Pencil, ShieldOff, Smartphone, Trash2 } from 'lucide-react'
import { MAX_DEVICE_ALIAS_LENGTH, type PanelDeviceInfo } from '@clara/shared-types'
import { formatRelative, formatTimestamp, shortId } from '../lib/format.ts'
import { deletePanel, patchPanel, postPanel } from '../lib/panel-api.ts'
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
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const active = devices.filter((device) => !device.revokedAt)
  const revoked = devices.filter((device) => device.revokedAt)

  const startEdit = (device: PanelDeviceInfo) => {
    setEditing(device.id)
    setDraft(device.alias ?? '')
    setError(undefined)
  }

  const cancelEdit = () => {
    setEditing(null)
    setDraft('')
  }

  const saveAlias = async (device: PanelDeviceInfo) => {
    setPending(device.id)
    setError(undefined)
    try {
      await patchPanel(`/panel/api/v1/devices/${encodeURIComponent(device.id)}`, {
        alias: draft.trim() || null,
      })
      cancelEdit()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  const revoke = async (device: PanelDeviceInfo) => {
    if (
      !window.confirm(
        `Revoke ${device.alias ?? device.label}? Its key is deleted and live sessions are disconnected.`
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

  const purge = async (device: PanelDeviceInfo) => {
    setPending(device.id)
    setError(undefined)
    try {
      await postPanel(`/panel/api/v1/devices/${encodeURIComponent(device.id)}/purge`, {})
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
                      {editing === device.id ? (
                        <>
                          <input
                            type="text"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void saveAlias(device)
                              } else if (event.key === 'Escape') {
                                cancelEdit()
                              }
                            }}
                            maxLength={MAX_DEVICE_ALIAS_LENGTH}
                            placeholder={device.label}
                            aria-label={`Alias for ${device.label}`}
                            autoFocus
                            className="w-full min-w-40 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-400"
                          />
                          <div className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                            {masked ? PEEK_MASK : shortId(device.id)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium">{device.alias ?? device.label}</div>
                          {device.alias ? (
                            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                              Enrolled as {device.label}
                            </div>
                          ) : null}
                          <div className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                            {masked ? PEEK_MASK : shortId(device.id)}
                          </div>
                        </>
                      )}
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
                        <button
                          type="button"
                          disabled={pending === device.id}
                          onClick={() => void purge(device)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50"
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                          {pending === device.id ? 'Deleting…' : 'Delete'}
                        </button>
                      ) : editing === device.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={pending === device.id}
                            onClick={() => void saveAlias(device)}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-[10px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                          >
                            {pending === device.id ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            disabled={pending === device.id}
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-[10px] font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={pending === device.id}
                            onClick={() => startEdit(device)}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-[10px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                          >
                            <Pencil className="size-3" aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={pending === device.id}
                            onClick={() => void revoke(device)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50"
                          >
                            <ShieldOff className="size-3" aria-hidden="true" />
                            {pending === device.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        </div>
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
          An alias changes only the name shown here; the enrolled label stays with the device
          record. Each device has its own key. Revoking one does not affect the others. Delete a
          revoked device to remove its record. Multiple live sessions on one device are usually tabs
          of the same browser.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
