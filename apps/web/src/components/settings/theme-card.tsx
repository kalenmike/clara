import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { COLOR_THEMES } from '@/features/theme/color-theme'
import { useColorTheme } from '@/features/theme/use-color-theme'
import { cn } from '@/lib/utils'

const MODES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function ThemeCard() {
  const { theme: mode, setTheme: setMode } = useTheme()
  const { theme, setTheme } = useColorTheme()

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
        <div className="space-y-2">
          <div className="text-xs font-medium">Mode</div>
          <div className="flex flex-wrap gap-2">
            {MODES.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                size="sm"
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
                className={cn(mode === option.value && 'border-foreground/40 bg-accent')}
              >
                <option.icon className="size-4" />
                {option.label}
                {mode === option.value && <Check className="size-3.5" />}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-medium">Color theme</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLOR_THEMES.map((option) => {
              const selected = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  aria-pressed={selected}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                    selected
                      ? 'border-foreground/40 bg-accent'
                      : 'border-border bg-background hover:bg-muted'
                  )}
                >
                  <span className="flex shrink-0 gap-1" aria-hidden>
                    {[option.preview.light, option.preview.dark].map(
                      ([background, primary], index) => (
                        <span
                          key={index}
                          className="size-6 rounded-md ring-1 ring-foreground/10"
                          style={{ backgroundColor: background }}
                        >
                          <span
                            className="m-1 block size-2 rounded-full"
                            style={{ backgroundColor: primary }}
                          />
                        </span>
                      )
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {option.label}
                  </span>
                  {selected && <Check className="size-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Every color theme has a light and dark variant. System follows your device setting.
        </p>
      </CardContent>
    </Card>
  )
}
