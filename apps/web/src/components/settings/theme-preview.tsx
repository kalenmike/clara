import { useEffect, useRef } from 'react'
import {
  THEME_TOKEN_NAMES,
  baseThemeTokens,
  type ThemeDefinition,
  type ThemeVariant,
} from '@clara/theme'

type ThemePreviewProps = {
  theme: ThemeDefinition
  mode: ThemeVariant
}

/**
 * A scoped sample of an imported theme. Only allowlisted tokens are set as
 * inline custom properties on this element; unspecified tokens fall back to the
 * hardcoded Default palette.
 */
export function ThemePreview({ theme, mode }: ThemePreviewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const tokens = { ...baseThemeTokens(mode), ...theme[mode] }
    for (const name of THEME_TOKEN_NAMES) {
      const value = tokens[name]
      if (value) element.style.setProperty(`--${name}`, value)
    }

    return () => {
      for (const name of THEME_TOKEN_NAMES) element.style.removeProperty(`--${name}`)
    }
  }, [theme, mode])

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg border border-border bg-background text-foreground"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-sidebar px-2 py-1.5 text-[10px] font-medium text-sidebar-foreground">
        <span className="size-1.5 rounded-full bg-primary" />
        {mode === 'light' ? 'Light' : 'Dark'}
      </div>
      <div className="space-y-2 p-2">
        <div className="rounded-md border border-border bg-card p-2 text-card-foreground">
          <div className="text-[10px] font-medium">Session</div>
          <div className="mt-1 text-[9px] text-muted-foreground">Working on the plan</div>
          <div className="mt-2 h-1.5 w-3/4 rounded-full bg-muted" />
          <div className="mt-1 h-1.5 w-1/2 rounded-full bg-muted" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-primary px-2 py-1 text-[9px] font-medium text-primary-foreground">
            Continue
          </span>
          <span className="rounded-md border border-border px-2 py-1 text-[9px]">Review</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-status-success" />
          <span className="size-1.5 rounded-full bg-status-warning" />
          <span className="size-1.5 rounded-full bg-status-info" />
          <span className="size-1.5 rounded-full bg-destructive" />
        </div>
      </div>
    </div>
  )
}
