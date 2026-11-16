import { FileJson } from 'lucide-react'
import type { ThemeParseError } from '@clara/theme'

export function ThemeImportErrors({ errors }: { errors: ThemeParseError[] }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <FileJson className="size-3.5" />
        This theme cannot be imported
      </div>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {errors.slice(0, 8).map((error) => (
          <li key={`${error.path}:${error.message}`}>
            <span className="font-mono text-foreground">{error.path}</span> {error.message}
          </li>
        ))}
        {errors.length > 8 && <li>{errors.length - 8} more problems</li>}
      </ul>
    </div>
  )
}
