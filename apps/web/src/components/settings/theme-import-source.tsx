import type { RefObject } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Textarea } from '@clara/ui/components/textarea'

type ThemeImportSourceProps = {
  fileInput: RefObject<HTMLInputElement | null>
  text: string
  onTextChange: (value: string) => void
  onFile: (file: File | undefined) => void
}

export function ThemeImportSource({
  fileInput,
  text,
  onTextChange,
  onFile,
}: ThemeImportSourceProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            onFile(file)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-4" />
          Choose JSON file
        </Button>
        <span className="text-[11px] text-muted-foreground">or paste it below</span>
      </div>

      <Textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={'{\n  "schemaVersion": 1,\n  "name": "My theme",\n  ...\n}'}
        spellCheck={false}
        aria-label="Theme JSON"
        className="min-h-40 font-mono text-xs"
      />
    </>
  )
}
