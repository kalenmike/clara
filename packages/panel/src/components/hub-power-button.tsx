import { useState } from 'react'
import { Power } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { GO_OFFLINE_UNAVAILABLE_REASON, usePanelCapabilities } from '../lib/capabilities-context.ts'
import { postPanel } from '../lib/panel-api.ts'
import { ConfirmDialog } from './confirm-dialog.tsx'

/**
 * The hub keeps its process and panel alive while external connections are
 * stopped. This control is shared by the Overview header and the Hub card in
 * Settings, so both places offer the same confirmed action.
 */
export function HubPowerButton({
  stopped,
  onChanged,
  onError,
}: {
  stopped: boolean
  onChanged: () => void
  onError?: (message: string | undefined) => void
}) {
  const { allowGoOffline } = usePanelCapabilities()
  const [pending, setPending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const apply = async (next: boolean) => {
    setPending(true)
    onError?.(undefined)
    try {
      await postPanel('/panel/api/v1/agent', { stopped: next })
      onChanged()
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
      setConfirmOpen(false)
    }
  }

  const toggle = () => {
    if (!stopped) {
      setConfirmOpen(true)
      return
    }
    void apply(false)
  }

  if (!allowGoOffline) return <PowerUnavailable stopped={stopped} />

  return (
    <>
      <Button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={
          stopped
            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
            : 'bg-red-600 text-white hover:bg-red-500'
        }
      >
        <Power className="size-3.5" aria-hidden="true" />
        {pending
          ? stopped
            ? 'Going online…'
            : 'Going offline…'
          : stopped
            ? 'Go online'
            : 'Go offline'}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Take Clara offline?"
        description="Every external connection is closed. The panel stays available so you can bring them back."
        confirmLabel="Go offline"
        pendingLabel="Going offline…"
        pending={pending}
        danger
        onOpenChange={setConfirmOpen}
        onConfirm={() => void apply(true)}
      />
    </>
  )
}

/** The read-only stand-in the bundled panel shows in both of its host cards. */
function PowerUnavailable({ stopped }: { stopped: boolean }) {
  const label = stopped ? 'Go online' : 'Go offline'

  return (
    <Button
      type="button"
      disabled
      aria-label={`${label}: unavailable in the bundled panel`}
      title={GO_OFFLINE_UNAVAILABLE_REASON}
      className={
        stopped
          ? 'bg-emerald-600 text-white hover:bg-emerald-600'
          : 'bg-red-600 text-white hover:bg-red-600'
      }
    >
      <Power className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  )
}
