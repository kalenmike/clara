import { useEffect, useRef } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import { useClientPairing } from '../lib/use-client-pairing.ts'
import { usePeek } from '../lib/peek-context.tsx'
import {
  PairClientFooter,
  PairClientHeader,
  PairClientPairingView,
  PairClientSetupView,
} from './pair-client-views.tsx'
import { Notice } from './primitives.tsx'

export function PairClientDialog({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { redact } = usePeek()
  const flow = useClientPairing({ open, snapshot, now, onChanged, onClose })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className="panel-setup-dialog panel-pair-dialog"
      aria-labelledby="panel-pair-title"
      onCancel={(event) => {
        event.preventDefault()
        void flow.close()
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) void flow.close()
      }}
    >
      <div className="panel-setup-card">
        <PairClientHeader pending={flow.pending} onClose={() => void flow.close()} />
        <div className="panel-setup-body">
          {flow.error ? <Notice tone="danger">{redact(flow.error)}</Notice> : null}
          {flow.pairing ? (
            <PairClientPairingView
              pairing={flow.pairing}
              connection={flow.connection}
              expired={flow.expired}
              now={now}
            />
          ) : (
            <PairClientSetupView flow={flow} />
          )}
        </div>
        <PairClientFooter flow={flow} />
      </div>
    </dialog>
  )
}
