import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { SYNC_INTERVAL_PRESETS_MS, type PanelSyncControl } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  Notice,
  Toggle,
  type ToggleState,
} from './primitives.tsx'

/**
 * Settings sync is global to the agent: one gate hides the web Sync tab on every
 * paired client, and one cadence controls how often those clients check for
 * changes. Local edits still push immediately.
 */
export function ClientSyncCard({
  sync,
  onChanged,
  defaultExpanded = false,
}: {
  sync: PanelSyncControl
  onChanged: () => void
  defaultExpanded?: boolean
}) {
  const [pending, setPending] = useState<'toggle' | 'interval'>()
  const [error, setError] = useState<string>()
  const { redact } = usePeek()
  const intervals = useMemo(() => {
    const values = [...SYNC_INTERVAL_PRESETS_MS]
    if (!values.includes(sync.intervalMs)) values.push(sync.intervalMs)
    return values.sort((left, right) => left - right)
  }, [sync.intervalMs])

  const update = async (next: PanelSyncControl, kind: 'toggle' | 'interval') => {
    setPending(kind)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/sync', next)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const toggleState: ToggleState = pending === 'toggle' ? 'pending' : sync.enabled ? 'on' : 'off'

  return (
    <CollapsibleCard
      title="Client sync"
      description="Share non-secret settings between paired clients"
      icon={<RefreshCw className="size-4" aria-hidden="true" />}
      defaultExpanded={defaultExpanded}
      action={
        <Badge tone={sync.enabled ? 'success' : 'neutral'}>{sync.enabled ? 'On' : 'Off'}</Badge>
      }
      control={
        <Toggle
          checked={sync.enabled}
          onChange={() => void update({ ...sync, enabled: !sync.enabled }, 'toggle')}
          label={`Client settings sync: ${sync.enabled ? 'on' : 'off'}`}
          state={toggleState}
          disabled={pending !== undefined}
        />
      }
      notice={
        error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(error)}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Paired clients check for settings changes at this cadence. A local edit still pushes
          immediately, and clients pull only when the server revision changes.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 px-2.5 py-2 dark:border-neutral-800">
          <div className="min-w-0">
            <label
              htmlFor="client-sync-interval"
              className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
            >
              Check interval
            </label>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Applies to every connected client and every new pairing.
            </p>
          </div>
          <select
            id="client-sync-interval"
            value={sync.intervalMs}
            onChange={(event) =>
              void update({ ...sync, intervalMs: Number(event.target.value) }, 'interval')
            }
            disabled={pending !== undefined}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 shadow-sm outline-none transition focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-600 dark:disabled:bg-neutral-900"
          >
            {intervals.map((interval) => (
              <option key={interval} value={interval}>
                {formatInterval(interval)}
              </option>
            ))}
          </select>
        </div>

        <p className="pt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          Turning sync off hides the Sync tab on every client and rejects sync requests. Stored
          per-client choices and the server namespace are kept, so turning it back on resumes where
          it stopped.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

function formatInterval(ms: number): string {
  const totalSeconds = Math.round(ms / 1_000)
  if (totalSeconds < 60) return `${totalSeconds} seconds`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (seconds > 0) return `${minutes}m ${seconds}s`
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}
