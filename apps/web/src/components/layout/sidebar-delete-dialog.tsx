import { useRef, type ComponentProps } from 'react'
import type { ClaraSession } from '@clara/api-contract'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSessionWording } from '@/features/sessions/use-wording'

export function SidebarDeleteDialog({
  open,
  sessions,
  deleting,
  onOpenChange,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean
  sessions: readonly ClaraSession[]
  deleting: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}) {
  const { lowerSingular, lowerPlural } = useSessionWording()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const count = sessions.length
  const title = count === 1 ? `Delete this ${lowerSingular}?` : `Delete ${count} ${lowerPlural}?`
  const description =
    count === 1
      ? `This permanently removes this ${lowerSingular} and all of its messages from the server. This action cannot be undone.`
      : `This permanently removes ${count} ${lowerPlural} and all of their messages from the server. This action cannot be undone.`
  const confirmLabel = count === 1 ? `Delete ${lowerSingular}` : `Delete ${count} ${lowerPlural}`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && deleting) return
        onOpenChange(next)
      }}
    >
      {count > 0 && (
        <DialogContent
          showCloseButton={!deleting}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelRef.current?.focus()
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (deleting) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (deleting) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (deleting) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={deleting}
              aria-label={confirmLabel}
            >
              {deleting && <Loader2 className="size-3.5 animate-spin" />}
              {deleting ? 'Deleting…' : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
