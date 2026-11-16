import { useState } from 'react'
import { Button } from '@clara/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clara/ui/components/dialog'
import { removeCustomTheme, type ColorThemeOption } from '@/features/theme/color-theme'

type ThemeRemoveDialogProps = {
  theme: ColorThemeOption | null
  onClose: () => void
}

export function ThemeRemoveDialog({ theme, onClose }: ThemeRemoveDialogProps) {
  const [error, setError] = useState<string | null>(null)

  function close() {
    setError(null)
    onClose()
  }

  function confirm() {
    if (!theme) return
    if (!removeCustomTheme(theme.value)) {
      setError('Clara could not remove this theme from the browser.')
      return
    }
    close()
  }

  return (
    <Dialog
      open={theme !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove {theme?.label ?? 'this theme'}?</DialogTitle>
          <DialogDescription>
            Clara removes the theme from this device. When Theme sync is on, it is removed from the
            hub as well and disappears from your other devices.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
