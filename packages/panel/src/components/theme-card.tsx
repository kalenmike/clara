import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { usePanelTheme } from '../lib/theme-context.ts'
import { CardBody, CollapsibleCard } from './primitives.tsx'

const MODES = [
  { value: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
  { value: 'system', label: 'System', hint: 'Follow your device', icon: Monitor },
] as const

export function ThemeCard() {
  const { mode, setMode } = usePanelTheme()

  return (
    <CollapsibleCard
      title="Appearance"
      description="Choose how the panel follows light or dark mode"
      icon={<Palette className="size-4" aria-hidden="true" />}
      defaultExpanded
    >
      <CardBody>
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Panel theme">
          {MODES.map((option) => {
            const selected = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                aria-pressed={selected}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-ring hover:bg-accent'
                }`}
              >
                <option.icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground">{option.label}</span>
                  <span className="block text-[10px] text-muted-foreground/70">{option.hint}</span>
                </span>
                {selected ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            )
          })}
        </div>
        <p className="pt-2 text-[11px] text-muted-foreground">
          System follows your operating system setting. The choice is stored in this browser.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
