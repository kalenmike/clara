import { useState } from 'react'
import { Palette, Upload } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import { Separator } from '@clara/ui/components/separator'
import { useColorTheme, useColorThemes } from '@/features/theme/use-color-theme'
import type { ColorThemeOption } from '@/features/theme/color-theme'
import { CustomThemeDialog } from './custom-theme-dialog'
import { ThemeModePicker } from './theme-mode-picker'
import { ThemeOptionGrid } from './theme-option-grid'
import { ThemeRemoveDialog } from './theme-remove-dialog'

export function ThemeCard() {
  const { theme, setTheme } = useColorTheme()
  const themes = useColorThemes()
  const [importOpen, setImportOpen] = useState(false)
  const [removing, setRemoving] = useState<ColorThemeOption | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Palette className="size-4" /> Appearance
        </CardTitle>
        <CardDescription>
          Choose a color theme and whether Clara follows light, dark, or your system.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ThemeModePicker />

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">Color theme</div>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-3.5" />
              Import theme
            </Button>
          </div>
          <ThemeOptionGrid
            themes={themes}
            selected={theme}
            onSelect={setTheme}
            onRemove={setRemoving}
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Every color theme has a light and dark variant. System follows your device setting. Custom
          themes are stored on this device; with Theme sync on, your hub stores them for your other
          devices.
        </p>
      </CardContent>

      <CustomThemeDialog open={importOpen} onOpenChange={setImportOpen} />
      <ThemeRemoveDialog theme={removing} onClose={() => setRemoving(null)} />
    </Card>
  )
}
