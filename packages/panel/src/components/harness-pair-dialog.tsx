import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import { useHarnessPairing } from '../lib/use-harness-pairing.ts'
import { HarnessSelectPortalProvider } from './harness-select-portal.tsx'
import { HarnessPairContent, HarnessPairFooter, HarnessPairHeader } from './harness-pair-views.tsx'

export function HarnessPairDialog({
  open,
  snapshot,
  now,
  onChanged,
  onClose,
  initialCode,
}: {
  open: boolean
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  onClose: () => void
  initialCode?: string
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [dialogElement, setDialogElement] = useState<HTMLDialogElement | null>(null)
  const setDialogRef = useCallback((element: HTMLDialogElement | null) => {
    dialogRef.current = element
    setDialogElement(element)
  }, [])
  const flow = useHarnessPairing({
    open,
    snapshot,
    now,
    onChanged,
    onClose,
    ...(initialCode ? { initialCode } : {}),
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
      ref={setDialogRef}
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
      <HarnessSelectPortalProvider container={dialogElement}>
        <div className="panel-setup-card">
          <HarnessPairHeader pending={flow.pending} onClose={() => void flow.close()} />
          <div className="panel-setup-body">
            <HarnessPairContent flow={flow} now={now} />
          </div>
          <HarnessPairFooter flow={flow} />
        </div>
      </HarnessSelectPortalProvider>
    </dialog>
  )
}
