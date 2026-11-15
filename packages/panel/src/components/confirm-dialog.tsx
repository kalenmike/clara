import { useEffect, useId, useRef } from 'react'
import { Loader2 } from 'lucide-react'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = 'Working…',
  pending = false,
  danger = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  pendingLabel?: string
  pending?: boolean
  danger?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  const close = () => {
    if (!pending) onOpenChange(false)
  }

  return (
    <dialog
      ref={dialogRef}
      className="panel-confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) close()
      }}
    >
      <div className="panel-confirm-card">
        <div className="panel-confirm-head">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p id={descriptionId} className="panel-muted mt-1 text-xs">
            {description}
          </p>
        </div>
        <div className="panel-confirm-foot">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            autoFocus
            className="panel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`panel-button ${danger ? 'danger' : 'primary'}`}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
