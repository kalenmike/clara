import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { cn } from '@clara/ui/lib/utils'

const MODES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function ThemeModePicker() {
  const { theme: mode, setTheme } = useTheme()

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Mode</div>
      <div className="flex flex-wrap gap-2">
        {MODES.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            size="sm"
            onClick={() => setTheme(option.value)}
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
  )
}
