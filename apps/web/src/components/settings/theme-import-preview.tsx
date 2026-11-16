import type { ThemeDefinition } from '@clara/theme'
import { ThemePreview } from './theme-preview'

export function ThemeImportPreview({ theme }: { theme: ThemeDefinition }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{theme.name}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ThemePreview theme={theme} mode="light" />
        <ThemePreview theme={theme} mode="dark" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Unspecified tokens use the Default palette. The theme is stored on this device and joins
        Theme sync when it is enabled.
      </p>
    </div>
  )
}
