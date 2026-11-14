import { useEffect, useRef } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import type { HarnessMachine } from '../lib/harness-pairing.ts'
import { useHarnessPairing } from '../lib/use-harness-pairing.ts'
import { HarnessPairContent, HarnessPairFooter, HarnessPairHeader } from './harness-pair-views.tsx'

export function HarnessPairDialog({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
  initialMachine,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose: () => void
  initialMachine?: HarnessMachine
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const flow = useHarnessPairing({
    open,
    snapshot,
    now,
    onChanged,
    onClose,
    ...(initialMachine ? { initialMachine } : {}),
  })

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
      aria-labelledby="panel-harness-pair-title"
      onCancel={(event) => {
        event.preventDefault()
        void flow.close()
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) void flow.close()
      }}
    >
      <div className="panel-setup-card">
        <HarnessPairHeader pending={flow.pending} onClose={() => void flow.close()} />
        <div className="panel-setup-body">
          <HarnessPairContent flow={flow} now={now} />
        </div>
        <HarnessPairFooter flow={flow} />
      </div>
    </dialog>
  )
}
