import { Button } from '@clara/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clara/ui/components/dialog'
import { ThemeImportErrors } from './theme-import-errors'
import { ThemeImportPreview } from './theme-import-preview'
import { ThemeImportSource } from './theme-import-source'
import { useThemeImport } from './use-theme-import'

type CustomThemeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CustomThemeDialog({ open, onOpenChange }: CustomThemeDialogProps) {
  const { fileInput, text, parsed, errors, updateText, readFile, addTheme, reset } =
    useThemeImport()

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function submit() {
    if (addTheme()) handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a theme</DialogTitle>
          <DialogDescription>
            Upload or paste a Clara theme JSON. Only the known colour tokens are accepted; extra CSS
            is rejected and never injected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ThemeImportSource
            fileInput={fileInput}
            text={text}
            onTextChange={updateText}
            onFile={(file) => void readFile(file)}
          />
          {errors.length > 0 && <ThemeImportErrors errors={errors} />}
          {parsed?.ok && <ThemeImportPreview theme={parsed.value} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!parsed?.ok}>
            Add theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
