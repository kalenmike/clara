import { Check, Trash2 } from 'lucide-react'
import { cn } from '@clara/ui/lib/utils'
import type { ColorThemeOption } from '@/features/theme/color-theme'

type ThemeOptionGridProps = {
  themes: ColorThemeOption[]
  selected: string
  onSelect: (theme: string) => void
  onRemove: (theme: ColorThemeOption) => void
}

export function ThemeOptionGrid({ themes, selected, onSelect, onRemove }: ThemeOptionGridProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {themes.map((option) => {
        const active = selected === option.value
        return (
          <div
            key={option.value}
            className={cn(
              'flex items-stretch rounded-lg border transition-colors',
              active
                ? 'border-foreground/40 bg-accent'
                : 'border-border bg-background hover:bg-muted'
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={active}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left"
            >
              <span className="flex shrink-0 gap-1" aria-hidden>
                {[option.preview.light, option.preview.dark].map(([background, primary], index) => (
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
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
              {active && <Check className="size-3.5 shrink-0" />}
            </button>
            {option.custom && (
              <button
                type="button"
                onClick={() => onRemove(option)}
                aria-label={`Remove ${option.label}`}
                title={`Remove ${option.label}`}
                className="flex w-8 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
